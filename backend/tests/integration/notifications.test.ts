import { beforeEach, describe, expect, it } from 'vitest'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { resetDb } from '../../src/db/seed.ts'
import { drainOutbox } from '../../src/outbox.ts'
import { FakeWhatsApp, isQuietHour, reminderKind, scanNotifications } from '../../src/notifications.ts'
import { approveApplication, callerFor, newStudent, prisma, vacantRoom } from '../helpers.ts'

beforeEach(async () => {
  await resetDb(prisma)
  // The seed has live tenancies with unpaid invoices; settle them so each test only sees the invoices it builds.
  await prisma.invoice.updateMany({ data: { status: 'PAID' } })
})

/** A moment at `hour` o'clock WIB on the WIB calendar day `date` (WIB = UTC+7, no DST). */
const wib = (date: string, hour = 10) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+07:00`)

async function activeInvoice(over: { phone?: string | null; contact?: boolean; optOut?: boolean; isDemo?: boolean } = {}) {
  const s = await newStudent()
  await prisma.user.update({
    where: { id: s.id },
    data: {
      phone: over.phone === undefined ? '081200000001' : over.phone,
      notifyOptOut: over.optOut ?? false,
      isDemo: over.isDemo ?? false,
      ...(over.contact === false ? {} : { emergencyContactName: 'Bu Sari', emergencyContactRelation: 'Ibu', emergencyContactPhone: '081200000009', emergencyContactConsentAt: new Date() }),
    },
  })
  const a = await approveApplication(s.id, (await vacantRoom()).id)
  await prisma.tenancy.update({ where: { id: a.tenancyId }, data: { status: 'ACTIVE' } })
  const setDue = (date: string) => prisma.invoice.update({ where: { id: a.invoiceId }, data: { dueDate: new Date(`${date}T00:00:00Z`) } })
  return { ...a, userId: s.id, setDue }
}
const logs = (invoiceId: string) => prisma.notificationLog.findMany({ where: { invoiceId }, orderBy: [{ kind: 'asc' }, { channel: 'asc' }] })

describe('reminder kinds and quiet hours', () => {
  it('maps days-to-due to H-7, H-3, H-1 and nothing else', () => {
    expect([8, 7, 5, 4, 3, 2, 1, 0, -1].map(reminderKind)).toEqual([null, 'REMINDER_H7', 'REMINDER_H7', 'REMINDER_H7', 'REMINDER_H3', 'REMINDER_H3', 'REMINDER_H1', 'REMINDER_H1', null])
  })
  it('treats 20:00 to 07:59 WIB as quiet', () => {
    expect([wib('2026-11-01', 7), wib('2026-11-01', 8), wib('2026-11-01', 19), wib('2026-11-01', 20), wib('2026-11-01', 23)].map(isQuietHour)).toEqual([true, false, false, true, true])
  })
})

describe('scanNotifications', () => {
  const today = todayWIB(new Date())

  it('sends an email and a WhatsApp at H-3, once, however often it scans', async () => {
    const inv = await activeInvoice()
    await inv.setDue(addDays(today, 3))
    const wa = new FakeWhatsApp()
    const first = await scanNotifications(prisma, wib(today), { whatsapp: wa })
    expect(first.sent).toBe(2)
    await scanNotifications(prisma, wib(today, 15), { whatsapp: wa })
    expect(wa.sent).toHaveLength(1)
    expect(wa.sent[0]).toMatchObject({ to: '081200000001', kind: 'REMINDER_H3' })
    expect(wa.sent[0]!.text).toContain('3 hari lagi')
    expect((await logs(inv.invoiceId)).map((l) => `${l.kind}/${l.channel}/${l.status}`)).toEqual(['REMINDER_H3/EMAIL/SENT', 'REMINDER_H3/WHATSAPP/SENT'])
    const outbox = await prisma.emailOutbox.findMany({ where: { template: 'invoice-reminder' } })
    expect(outbox).toHaveLength(1)
    const sent: string[] = []
    await drainOutbox(prisma, { send: async (m) => void sent.push(m.subject) })
    expect(sent.some((s) => s.includes('jatuh tempo 3 hari lagi'))).toBe(true)
  })

  it('advances through H-7, H-3 and H-1 as the clock moves, one send per kind', async () => {
    const inv = await activeInvoice({ contact: false })
    const due = addDays(today, 10)
    await inv.setDue(due)
    const wa = new FakeWhatsApp()
    for (const offset of [-12, -7, -6, -3, -2, -1, 0]) {
      const r = await scanNotifications(prisma, wib(addDays(due, offset)), { whatsapp: wa })
      expect(r.failed).toBe(0)
      expect(await prisma.notificationLog.count({ where: { invoiceId: inv.invoiceId, channel: 'WHATSAPP' } })).toBe([-7, -3, -1].filter((o) => o <= offset).length)
    }
    expect(wa.sent.map((m) => m.kind)).toEqual(['REMINDER_H7', 'REMINDER_H3', 'REMINDER_H1'])
  })

  it('sends nothing at night and sends after 08:00 instead', async () => {
    const inv = await activeInvoice()
    await inv.setDue(addDays(today, 1))
    const wa = new FakeWhatsApp()
    const night = await scanNotifications(prisma, wib(today, 22), { whatsapp: wa })
    expect(night.skippedQuietHours).toBe(true)
    expect(await logs(inv.invoiceId)).toHaveLength(0)
    await scanNotifications(prisma, wib(today, 9), { whatsapp: wa })
    expect(wa.sent).toHaveLength(1)
  })

  it('skips reminders for a student who opted out, a missing phone (email still goes), and demo accounts', async () => {
    const optedOut = await activeInvoice({ optOut: true })
    const noPhone = await activeInvoice({ phone: null })
    const demo = await activeInvoice({ isDemo: true })
    for (const i of [optedOut, noPhone, demo]) await i.setDue(addDays(today, 1))
    const wa = new FakeWhatsApp()
    await scanNotifications(prisma, wib(today), { whatsapp: wa })
    expect(await logs(optedOut.invoiceId)).toHaveLength(0)
    expect((await logs(noPhone.invoiceId)).map((l) => l.channel)).toEqual(['EMAIL'])
    expect(await logs(demo.invoiceId)).toHaveLength(0)
    expect(wa.sent).toHaveLength(0)
  })

  it('ignores a paid invoice and a pending (unpaid hold) tenancy', async () => {
    const paid = await activeInvoice()
    await paid.setDue(addDays(today, 1))
    await prisma.invoice.update({ where: { id: paid.invoiceId }, data: { status: 'PAID' } })
    const held = await activeInvoice()
    await held.setDue(addDays(today, 1))
    await prisma.tenancy.update({ where: { id: held.tenancyId }, data: { status: 'PENDING' } })
    await scanNotifications(prisma, wib(today), { whatsapp: new FakeWhatsApp() })
    expect(await logs(paid.invoiceId)).toHaveLength(0)
    expect(await logs(held.invoiceId)).toHaveLength(0)
  })

  it('contacts the emergency contact once, a week after the due date, only with consent, with minimal wording', async () => {
    const consenting = await activeInvoice()
    const without = await activeInvoice({ contact: false })
    const due = addDays(today, -7)
    await consenting.setDue(due)
    await without.setDue(due)
    const wa = new FakeWhatsApp()
    await scanNotifications(prisma, wib(addDays(due, 6)), { whatsapp: wa })
    expect(wa.sent).toHaveLength(0)
    await scanNotifications(prisma, wib(today), { whatsapp: wa })
    await scanNotifications(prisma, wib(today, 16), { whatsapp: wa })
    expect(wa.sent).toHaveLength(1)
    const m = wa.sent[0]!
    expect(m).toMatchObject({ to: '081200000009', kind: 'EMERGENCY_CONTACT' })
    expect(m.text).toContain('Bu Sari')
    expect(m.text).not.toMatch(/Rp|\d{3}\.\d{3}/)
    expect(await logs(without.invoiceId)).toHaveLength(0)
    expect((await logs(consenting.invoiceId)).map((l) => l.recipient)).toEqual(['KONTAK_DARURAT'])
  })

  it('marks a failed WhatsApp send FAILED and does not retry it every scan', async () => {
    const inv = await activeInvoice({ contact: false })
    await inv.setDue(addDays(today, 1))
    const wa = new FakeWhatsApp()
    wa.failWith = new Error('gateway 500')
    const r = await scanNotifications(prisma, wib(today), { whatsapp: wa })
    expect(r.failed).toBe(1)
    const row = (await logs(inv.invoiceId)).find((l) => l.channel === 'WHATSAPP')!
    expect(row).toMatchObject({ status: 'FAILED', reason: 'gateway 500' })
    wa.failWith = null
    await scanNotifications(prisma, wib(today, 14), { whatsapp: wa })
    expect(wa.sent).toHaveLength(0)
  })

  it('shows the owner their kos log and no other owner', async () => {
    const inv = await activeInvoice()
    await inv.setDue(addDays(today, 1))
    await scanNotifications(prisma, wib(today), { whatsapp: new FakeWhatsApp() })
    const kos = await prisma.kos.findUniqueOrThrow({ where: { id: inv.room.kosId }, include: { owner: true } })
    const rows = await callerFor(kos.owner.userId).owner.tenant.notifications({ kosId: kos.id })
    expect(rows.map((r) => `${r.kind}/${r.channel}`).sort()).toEqual(['REMINDER_H1/EMAIL', 'REMINDER_H1/WHATSAPP'])
    expect(rows[0]).toMatchObject({ roomNumber: inv.room.roomNumber, recipient: 'PENYEWA' })
    const stranger = await prisma.ownerProfile.findFirstOrThrow({ where: { id: { not: kos.ownerId } } })
    await expect(callerFor(stranger.userId).owner.tenant.notifications({ kosId: kos.id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
