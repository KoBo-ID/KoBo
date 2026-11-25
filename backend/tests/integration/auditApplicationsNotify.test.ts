import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { renderEmail } from '../../src/emailTemplates.ts'
import { FakeWhatsApp, scanNotifications } from '../../src/notifications.ts'
import { drainOutbox, type EmailMessage } from '../../src/outbox.ts'
import { callerFor, cash, DEMO_STUDENT_ID, newStudent, prisma } from '../helpers.ts'
import { makeKos, newOwner } from './gap-helpers.ts'

beforeEach(async () => {
  await resetDb(prisma)
  await prisma.emailOutbox.deleteMany()
})

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null

async function makeRealKosWithRooms(count = 1) {
  const rooms = Array.from({ length: count }, (_, i) => ({ n: `20${i + 1}`, type: 'Standar', price: 1_800_000 }))
  const k = await makeKos(rooms, { applicationFee: 25_000, studentDiscountAmount: 0 })
  const ownerUser = await prisma.user.findUniqueOrThrow({ where: { id: k.ownerUserId } })
  return { ...k, ownerCaller: callerFor(k.ownerUserId), ownerUser }
}

describe('[SIM-006] application.decide reason, note, contact filter, and sibling auto-reject', () => {
  it('rejects reason or note on APPROVE with BAD_REQUEST', async () => {
    const k = await makeRealKosWithRooms(1)
    const student = await newStudent()
    const app = await callerFor(student.id).application.create({
      roomId: k.room('201').id,
      startDate: addDays(todayWIB(new Date()), 5),
      durationMonths: 6,
    })

    const withReason = await err(k.ownerCaller.application.decide({ kosId: k.kos.id, applicationId: app.id, decision: 'APPROVE', reason: 'LAINNYA' }))
    expect(withReason?.code).toBe('BAD_REQUEST')
    const withNote = await err(k.ownerCaller.application.decide({ kosId: k.kos.id, applicationId: app.id, decision: 'APPROVE', note: 'Selamat datang' }))
    expect(withNote?.code).toBe('BAD_REQUEST')
    expect((await prisma.rentalApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('PENDING')
  })

  it('rejects contact details (phone, email, wa.me) and over-long notes with BAD_REQUEST', async () => {
    const k = await makeRealKosWithRooms(1)
    const student = await newStudent()
    const app = await callerFor(student.id).application.create({
      roomId: k.room('201').id,
      startDate: addDays(todayWIB(new Date()), 5),
      durationMonths: 6,
    })

    for (const badNote of [
      'Hubungi saya di 081234567890 ya',
      'Email ke pemilik@example.com saja',
      'Chat lewat wa.me/628123456789',
      'a'.repeat(201),
    ]) {
      const e = await err(k.ownerCaller.application.decide({ kosId: k.kos.id, applicationId: app.id, decision: 'REJECT', reason: 'LAINNYA', note: badNote }))
      expect(e?.code, badNote).toBe('BAD_REQUEST')
    }
    expect((await prisma.rentalApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe('PENDING')
  })

  it('persists manual rejection reason and note, exposes them in application.mine, and sets MEMILIH_PENGAJU_LAIN on auto-rejected siblings', async () => {
    const k = await makeRealKosWithRooms(2)
    const s1 = await newStudent()
    const s2 = await newStudent()
    const s3 = await newStudent()
    const start = addDays(todayWIB(new Date()), 5)

    // Manual reject with reason + note on room 201
    const a1 = await callerFor(s1.id).application.create({ roomId: k.room('201').id, startDate: start, durationMonths: 6 })
    await k.ownerCaller.application.decide({
      kosId: k.kos.id,
      applicationId: a1.id,
      decision: 'REJECT',
      reason: 'TANGGAL_TIDAK_COCOK',
      note: 'Kamar baru kosong mulai bulan depan.',
    })
    const mine1 = (await callerFor(s1.id).application.mine()).find((x) => x.id === a1.id)!
    expect(mine1).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'TANGGAL_TIDAK_COCOK',
      decisionNote: 'Kamar baru kosong mulai bulan depan.',
    })

    // Two applicants on room 202 -> approve s2 -> s3 auto-rejected with MEMILIH_PENGAJU_LAIN and null note
    const a2 = await callerFor(s2.id).application.create({ roomId: k.room('202').id, startDate: start, durationMonths: 6 })
    const a3 = await callerFor(s3.id).application.create({ roomId: k.room('202').id, startDate: start, durationMonths: 6 })
    await k.ownerCaller.application.decide({ kosId: k.kos.id, applicationId: a2.id, decision: 'APPROVE' })

    const mine3 = (await callerFor(s3.id).application.mine()).find((x) => x.id === a3.id)!
    expect(mine3).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'MEMILIH_PENGAJU_LAIN',
      decisionNote: null,
    })
  })
})

describe('[SIM-002] N1-N3 application outbox notifications and demo exclusion', () => {
  it('enqueues N1 (owner), N2 (approved student), and N3 (rejected + auto-rejected sibling) exactly once with typed payloads that render cleanly', async () => {
    const k = await makeRealKosWithRooms(2)
    const start = addDays(todayWIB(new Date()), 7)
    const winner = await newStudent()
    const sibling = await newStudent()
    const manualRejectee = await newStudent()

    // N1: application.create -> owner
    const appWin = await callerFor(winner.id).application.create({ roomId: k.room('201').id, startDate: start, durationMonths: 6 })
    const n1Rows = await prisma.emailOutbox.findMany({ where: { template: 'application-new' } })
    expect(n1Rows).toHaveLength(1)
    expect(n1Rows[0]!.to).toBe(k.ownerUser.email)
    expect(n1Rows[0]!.payload).toMatchObject({
      ownerName: k.ownerUser.name,
      studentName: winner.name,
      kosName: k.kos.name,
      roomNumber: '201',
      startDate: start,
      durationMonths: 6,
    })
    expect(String((n1Rows[0]!.payload as Record<string, unknown>).dashboardUrl)).toContain(`/owner/dashboard?kos=${k.kos.id}`)

    // Sibling applies to same room 201 -> another N1
    await callerFor(sibling.id).application.create({ roomId: k.room('201').id, startDate: start, durationMonths: 6 })
    // Manual rejectee applies to room 202
    const appRej = await callerFor(manualRejectee.id).application.create({ roomId: k.room('202').id, startDate: start, durationMonths: 3 })
    expect(await prisma.emailOutbox.count({ where: { template: 'application-new' } })).toBe(3)

    // Approve winner -> N2 to winner + N3 to sibling
    await k.ownerCaller.application.decide({ kosId: k.kos.id, applicationId: appWin.id, decision: 'APPROVE' })
    const n2Rows = await prisma.emailOutbox.findMany({ where: { template: 'application-approved' } })
    expect(n2Rows).toHaveLength(1)
    expect(n2Rows[0]!.to).toBe(winner.email)
    expect(n2Rows[0]!.payload).toMatchObject({
      studentName: winner.name,
      kosName: k.kos.name,
      roomNumber: '201',
      amount: 1_825_000,
    })
    expect(String((n2Rows[0]!.payload as Record<string, unknown>).myKosUrl)).toMatch(/\/my-kos$/)
    expect(typeof (n2Rows[0]!.payload as Record<string, unknown>).holdExpiresAt).toBe('string')

    // Reject manualRejectee with reason + note -> N3 to manualRejectee
    await k.ownerCaller.application.decide({
      kosId: k.kos.id,
      applicationId: appRej.id,
      decision: 'REJECT',
      reason: 'KAMAR_TIDAK_TERSEDIA',
      note: 'Sedang renovasi minggu ini.',
    })
    const n3Rows = await prisma.emailOutbox.findMany({ where: { template: 'application-rejected' }, orderBy: { createdAt: 'asc' } })
    expect(n3Rows).toHaveLength(2)
    const sibMail = n3Rows.find((r) => r.to === sibling.email)!
    expect(sibMail.payload).toMatchObject({
      studentName: sibling.name,
      kosName: k.kos.name,
      roomNumber: '201',
      reasonText: 'Pemilik menerima pengajuan lain untuk kamar ini.',
    })
    expect((sibMail.payload as Record<string, unknown>).note).toBeUndefined()

    const rejMail = n3Rows.find((r) => r.to === manualRejectee.email)!
    expect(rejMail.payload).toMatchObject({
      studentName: manualRejectee.name,
      kosName: k.kos.name,
      roomNumber: '202',
      reasonText: 'Kamar ini tidak tersedia untuk tanggal yang Anda ajukan.',
      note: 'Sedang renovasi minggu ini.',
    })

    // Drain every queued row and verify all 6 render and send cleanly without failures.
    const sent: EmailMessage[] = []
    const drained = await drainOutbox(prisma, { send: async (m) => void sent.push(m) }, { batchSize: 20 })
    expect(drained).toEqual({ claimed: 6, sent: 6, failed: 0 })
    expect(sent.find((m) => m.to === winner.email)!.text).toContain('Rp 1.825.000')
    expect(sent.find((m) => m.to === manualRejectee.email)!.text).toContain('Sedang renovasi minggu ini.')
    const rejText = sent.find((m) => m.to === manualRejectee.email)!.text
    expect(rejText).toContain('Tidak ada biaya yang ditagihkan')
    expect(rejText).not.toContain('..')
  })

  it('sends no emails for demo students or demo-owned kos', async () => {
    const k = await makeRealKosWithRooms(1)
    const start = addDays(todayWIB(new Date()), 5)

    // Demo student on real kos -> no N1, no N2
    const appDemoStudent = await callerFor(DEMO_STUDENT_ID, { isDemo: true }).application.create({
      roomId: k.room('201').id,
      startDate: start,
      durationMonths: 3,
    })
    await k.ownerCaller.application.decide({ kosId: k.kos.id, applicationId: appDemoStudent.id, decision: 'APPROVE' })
    expect(await prisma.emailOutbox.count()).toBe(0)

    // Real student on demo-owned kos -> no N1, no N3
    const demoOwner = await newOwner()
    await prisma.user.update({ where: { id: demoOwner.userId }, data: { isDemo: true } })
    const demoKos = await prisma.kos.create({
      data: {
        slug: `demo-notif-${Date.now()}`,
        name: 'Kos Demo Notif',
        gender: 'CAMPUR',
        address: 'Jl. Demo',
        district: 'Kemanggisan',
        city: 'Jakarta',
        lat: -6.2,
        lng: 106.8,
        electricityType: 'INCLUDED',
        ownerId: demoOwner.ownerId,
        rooms: { create: [{ roomNumber: 'D1', floor: 1, type: 'Standar', size: '3x3', bedType: 'Single', priceMonthly: 1_500_000 }] },
      },
      include: { rooms: true },
    })
    const realStudent = await newStudent()
    const appDemoKos = await callerFor(realStudent.id).application.create({
      roomId: demoKos.rooms[0]!.id,
      startDate: start,
      durationMonths: 3,
    })
    await demoOwner.c.application.decide({ kosId: demoKos.id, applicationId: appDemoKos.id, decision: 'REJECT', reason: 'LAINNYA' })
    expect(await prisma.emailOutbox.count()).toBe(0)
  })
})

describe('[SIM-002] N4 hold-expiring worker & [SIM-033] Indonesian reminder date', () => {
  it('fires N4 once inside the 6h window, skips demo users, and never fires outside the window, after payment, or after expiry', async () => {
    // Clear seeded unpaid invoices/holds so scanNotifications only sees our fixtures.
    await prisma.invoice.updateMany({ data: { status: 'PAID' } })
    await prisma.tenancy.updateMany({ where: { status: 'PENDING' }, data: { status: 'ENDED' } })

    const k = await makeRealKosWithRooms(4)
    const start = addDays(todayWIB(new Date()), 5)
    const now = new Date('2026-11-25T10:00:00.000Z') // 17:00 WIB

    const makeHold = async (roomNo: string, expiresAt: Date, opts: { isDemo?: boolean; pay?: boolean } = {}) => {
      const s = await newStudent()
      if (opts.isDemo) await prisma.user.update({ where: { id: s.id }, data: { isDemo: true } })
      const a = await callerFor(s.id, { isDemo: opts.isDemo }).application.create({ roomId: k.room(roomNo).id, startDate: start, durationMonths: 3 })
      const d = await k.ownerCaller.application.decide({ kosId: k.kos.id, applicationId: a.id, decision: 'APPROVE' })
      const inv = await prisma.invoice.findFirstOrThrow({ where: { tenancyId: d.tenancyId! } })
      await prisma.tenancy.update({ where: { id: d.tenancyId! }, data: { expiresAt } })
      if (opts.pay) await k.ownerCaller.payment.recordManual(await cash(k.kos.id, inv.id))
      return { student: s, tenancyId: d.tenancyId!, invoiceId: inv.id }
    }

    const inside = await makeHold('201', new Date(now.getTime() + 5 * 3600_000)) // 5h left -> SHOULD FIRE
    const tooEarly = await makeHold('202', new Date(now.getTime() + 7 * 3600_000)) // 7h left -> NOT YET
    const expired = await makeHold('203', new Date(now.getTime() - 60_000)) // expired -> NEVER
    const paid = await makeHold('204', new Date(now.getTime() + 4 * 3600_000), { pay: true }) // paid -> NEVER
    await prisma.emailOutbox.deleteMany()

    // First scan at `now`: only `inside` fires.
    const r1 = await scanNotifications(prisma, now, { whatsapp: new FakeWhatsApp() })
    expect(r1.sent).toBe(1)
    const rows1 = await prisma.emailOutbox.findMany({ where: { template: 'hold-expiring' } })
    expect(rows1).toHaveLength(1)
    expect(rows1[0]!.to).toBe(inside.student.email)
    expect(rows1[0]!.payload).toMatchObject({
      studentName: inside.student.name,
      kosName: k.kos.name,
      roomNumber: '201',
      amount: 1_825_000,
    })

    // NotificationLog kind is 'hold-expiring'
    const log = await prisma.notificationLog.findFirstOrThrow({ where: { invoiceId: inside.invoiceId, kind: 'hold-expiring' } })
    expect(log).toMatchObject({ kind: 'hold-expiring', channel: 'EMAIL', recipient: 'PENYEWA', status: 'SENT' })

    // Second scan 1 hour later: `inside` does NOT fire again; `tooEarly` (now 6h left) DOES fire once.
    const r2 = await scanNotifications(prisma, new Date(now.getTime() + 3600_000), { whatsapp: new FakeWhatsApp() })
    expect(r2.sent).toBe(1)
    const allRows = await prisma.emailOutbox.findMany({ where: { template: 'hold-expiring' } })
    expect(allRows.map((r) => r.to).sort()).toEqual([inside.student.email, tooEarly.student.email].sort())
    expect(await prisma.notificationLog.count({ where: { invoiceId: expired.invoiceId } })).toBe(0)
    expect(await prisma.notificationLog.count({ where: { invoiceId: paid.invoiceId } })).toBe(0)

    // Drained hold-expiring email renders cleanly with WIB date.
    const sent: EmailMessage[] = []
    const drained = await drainOutbox(prisma, { send: async (m) => void sent.push(m) }, { batchSize: 10 })
    expect(drained.failed).toBe(0)
    expect(sent[0]!.text).toContain('25 November 2026 pukul 22.00 WIB')
  })

  it('[SIM-033] formats invoice-reminder dueDate as "26 November 2026" instead of raw ISO', () => {
    const rendered = renderEmail('invoice-reminder', {
      name: 'Dimas',
      kosName: 'Kost Melati',
      roomNumber: '101',
      amount: 1_800_000,
      dueDate: '2026-11-26',
      days: 2,
      url: 'https://kobo.rent/my-kos',
    })
    expect(rendered).not.toBeNull()
    expect(rendered!.text).toContain('26 November 2026')
    expect(rendered!.text).not.toContain('2026-11-26')
    expect(rendered!.html).toContain('26 November 2026')
    expect(rendered!.html).not.toContain('2026-11-26')
  })

  it('[REV1-002] payment-received email uses "Pembayaran terverifikasi" and never implies KoBo holds funds', () => {
    const rendered = renderEmail('payment-received', {
      name: 'Dimas',
      url: 'https://kobo.rent/kuitansi/12',
    })
    expect(rendered).not.toBeNull()
    expect(rendered!.subject).toBe('Pembayaran terverifikasi - KoBo')
    expect(rendered!.text).toContain('terverifikasi')
    expect(rendered!.text).not.toContain('kami terima')
    expect(rendered!.html).not.toContain('kami terima')
  })
})
