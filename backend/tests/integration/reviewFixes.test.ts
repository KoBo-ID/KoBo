import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { DEMO_EMAILS } from '../../src/demo.ts'
import { assertDemoIsolation } from '../../src/demoIsolation.ts'
import { resetDemo } from '../../src/demoReset.ts'
import { drainOutbox, enqueueEmail, type EmailMessage } from '../../src/outbox.ts'
import { approveApplication, app, callerFor, DEMO_STUDENT_ID, newStudent, prisma, request, storage, vacantRoom } from '../helpers.ts'

/*
 * Regressions for the fixes that followed the independent review of the backend audit
 * (notes/analysis-backend/2026-10-26/review/REVIEW.md): each test names the finding it pins down.
 */

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const code = async (p: Promise<unknown>) => (await err(p))?.code
const startDate = () => addDays(todayWIB(new Date()), 5)
const appInput = (roomId: string) => ({ roomId, startDate: startDate(), durationMonths: 3, occupation: 'Mahasiswa' })

const kosInput = (over: Record<string, unknown> = {}) => ({
  name: 'Kost Regresi',
  gender: 'CAMPUR' as const,
  address: 'Jl. Uji No. 1',
  district: 'Kemanggisan',
  city: 'Jakarta Barat',
  lat: -6.2005,
  lng: 106.7855,
  electricityType: 'TOKEN' as const,
  privateAmenities: ['AC'],
  sharedAmenities: ['Wi-Fi'],
  studentDiscountAmount: 0,
  ...over,
})

/** The owner of the second seeded kos group: a real (non-demo) owner. */
async function realOwner() {
  const owners = await prisma.ownerProfile.findMany({ where: { user: { isDemo: false }, kos: { some: {} } }, orderBy: { id: 'asc' } })
  return { userId: owners[0].userId, profileId: owners[0].id }
}
async function demoOwnerUserId() {
  return (await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAILS.owner } })).id
}
async function ownerOfRoom(roomId: string) {
  const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId }, include: { kos: { include: { owner: true } } } })
  return { userId: room.kos.owner.userId, kosId: room.kosId }
}

describe('B07-001 application.decide is a compare-and-set', () => {
  it('lets exactly one of two concurrent decisions win and leaves a consistent state', async () => {
    for (let i = 0; i < 3; i++) {
      const room = await vacantRoom(i)
      const renter = await newStudent()
      const created = await callerFor(renter.id).application.create(appInput(room.id))
      const { userId, kosId } = await ownerOfRoom(room.id)
      const owner = callerFor(userId)
      const settled = await Promise.allSettled([
        owner.application.decide({ kosId, applicationId: created.id, decision: 'APPROVE' }),
        owner.application.decide({ kosId, applicationId: created.id, decision: 'REJECT' }),
      ])
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
      const loser = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult
      expect((loser.reason as TRPCError).code).toBe('CONFLICT')
      const row = await prisma.rentalApplication.findUniqueOrThrow({ where: { id: created.id } })
      const tenancies = await prisma.tenancy.count({ where: { roomId: room.id, userId: renter.id } })
      expect(row.status === 'APPROVED' ? tenancies === 1 && row.tenancyId !== null : tenancies === 0 && row.tenancyId === null).toBe(true)
    }
  })
})

describe('B08-001 discount never exceeds the rent', () => {
  it('approves a student whose kos discount is larger than the room rent, discounting the rent only', async () => {
    const room = await vacantRoom()
    await prisma.kos.update({ where: { id: room.kosId }, data: { studentDiscountAmount: room.priceMonthly + 50_000 } })
    const renter = await newStudent()
    await prisma.user.update({ where: { id: renter.id }, data: { campusEmailVerifiedAt: new Date(), campusEmail: 'x@binus.ac.id' } })
    const res = await approveApplication(renter.id, room.id, { startDate: startDate() })
    expect(res.invoice.discountAmount).toBe(room.priceMonthly)
    expect(res.invoice.ownerReceivableAmount).toBe(0)
    expect(res.invoice.amount).toBe(room.kos.applicationFee)
  })
})

describe('B06-001 archive instead of delete', () => {
  it('archives a kos and a room with tenancy history, keeps every row, and hides them', async () => {
    const { userId } = await realOwner()
    const owner = callerFor(userId)
    const k = await owner.owner.kos.create(kosInput({ initialRooms: { count: 2, priceMonthly: 1_000_000 } }))
    const rooms = await prisma.room.findMany({ where: { kosId: k.id }, orderBy: { roomNumber: 'asc' } })
    const res = await approveApplication(DEMO_STUDENT_ID, rooms[0].id, { startDate: startDate() })
    await prisma.tenancy.update({ where: { id: res.tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })

    // room with history: archived; room never used: deleted
    expect(await owner.owner.room.delete({ kosId: k.id, roomId: rooms[0].id })).toEqual({ id: rooms[0].id, archived: true })
    expect(await owner.owner.room.delete({ kosId: k.id, roomId: rooms[1].id })).toEqual({ id: rooms[1].id, archived: false })
    expect((await prisma.room.findUniqueOrThrow({ where: { id: rooms[0].id } })).archivedAt).not.toBeNull()
    expect(await prisma.room.count({ where: { id: rooms[1].id } })).toBe(0)

    // kos with history: archived, hidden from the marketplace and the owner list, rows intact
    expect(await owner.owner.kos.delete({ kosId: k.id })).toEqual({ id: k.id, archived: true })
    expect(await prisma.tenancy.count({ where: { id: res.tenancyId } })).toBe(1)
    expect(await prisma.invoice.count({ where: { id: res.invoiceId } })).toBe(1)
    expect((await callerFor(DEMO_STUDENT_ID).kos.list()).some((c) => c.id === k.id)).toBe(false)
    expect(await code(callerFor(DEMO_STUDENT_ID).kos.detail({ id: k.id }))).toBe('NOT_FOUND')
    expect((await owner.owner.myKos()).some((x) => x.id === k.id)).toBe(false)
    expect(await code(callerFor((await newStudent()).id).application.create(appInput(rooms[0].id)))).toBe('NOT_FOUND')
  })

  it('deletes a kos that never had a tenancy, and the database itself refuses to cascade over tenancy history', async () => {
    const { userId } = await realOwner()
    const owner = callerFor(userId)
    const empty = await owner.owner.kos.create(kosInput({ initialRooms: { count: 1, priceMonthly: 900_000 } }))
    expect(await owner.owner.kos.delete({ kosId: empty.id })).toEqual({ id: empty.id, archived: false })
    expect(await prisma.kos.count({ where: { id: empty.id } })).toBe(0)

    const used = await owner.owner.kos.create(kosInput({ initialRooms: { count: 1, priceMonthly: 900_000 } }))
    const room = await prisma.room.findFirstOrThrow({ where: { kosId: used.id } })
    await approveApplication(DEMO_STUDENT_ID, room.id, { startDate: startDate() })
    // a hard delete that bypasses the application (a race, or a script) must fail, not erase payment history
    await expect(prisma.kos.delete({ where: { id: used.id } })).rejects.toThrow()
    await expect(prisma.room.delete({ where: { id: room.id } })).rejects.toThrow()
    expect(await prisma.tenancy.count({ where: { roomId: room.id } })).toBe(1)
  })
})

describe('B21-002 demo reset spares kos that real users rented or applied to', () => {
  it('removes a demo-added kos nobody else used, keeps one a real student applied to', async () => {
    const demoOwner = callerFor(await demoOwnerUserId())
    const used = await demoOwner.owner.kos.create(kosInput({ name: 'Kos demo dipakai', initialRooms: { count: 1, priceMonthly: 1_000_000 } }))
    const unused = await demoOwner.owner.kos.create(kosInput({ name: 'Kos demo kosong', initialRooms: { count: 1, priceMonthly: 1_000_000 } }))
    const room = await prisma.room.findFirstOrThrow({ where: { kosId: used.id } })
    const real = await newStudent()
    const a = await approveApplication(real.id, room.id, { startDate: startDate() })

    await resetDemo(prisma, new Date())

    expect(await prisma.kos.count({ where: { id: unused.id } })).toBe(0)
    expect(await prisma.kos.count({ where: { id: used.id } })).toBe(1)
    expect(await prisma.tenancy.count({ where: { id: a.tenancyId } })).toBe(1)
    expect(await prisma.invoice.count({ where: { id: a.invoiceId } })).toBe(1)
  })
})

describe('B21-001 demo and real participation do not mix (DEMO_ISOLATION=1)', () => {
  const on = { DEMO_ISOLATION: '1' } as NodeJS.ProcessEnv

  it('is off by default', async () => {
    const room = await vacantRoom()
    await expect(assertDemoIsolation(prisma, { isDemo: false }, room.kosId, {} as NodeJS.ProcessEnv)).resolves.toBeUndefined()
  })

  it('keeps real accounts out of demo-owned kos and demo accounts out of real owners kos', async () => {
    const demoKos = await prisma.kos.findFirstOrThrow({ where: { owner: { user: { isDemo: true } } } })
    expect((await err(assertDemoIsolation(prisma, { isDemo: false }, demoKos.id, on)))?.code).toBe('FORBIDDEN')
    await expect(assertDemoIsolation(prisma, { isDemo: true }, demoKos.id, on)).resolves.toBeUndefined()

    // A seeded showcase owner has no login, so the demo student may use it ...
    const seeded = await prisma.kos.findFirstOrThrow({ where: { owner: { user: { isDemo: false } } } })
    await expect(assertDemoIsolation(prisma, { isDemo: true }, seeded.id, on)).resolves.toBeUndefined()
    // ... but a real owner who can sign in (has an Account row) is off limits for demo accounts.
    const ownerUser = await prisma.ownerProfile.findUniqueOrThrow({ where: { id: seeded.ownerId } })
    await prisma.account.create({ data: { accountId: ownerUser.userId, providerId: 'credential', userId: ownerUser.userId } })
    expect((await err(assertDemoIsolation(prisma, { isDemo: true }, seeded.id, on)))?.code).toBe('FORBIDDEN')
    await expect(assertDemoIsolation(prisma, { isDemo: false }, seeded.id, on)).resolves.toBeUndefined()
  })
})

describe('B03-002 one verified campus mailbox per account', () => {
  it('the database refuses a second verified account on the same mailbox, in any letter case', async () => {
    const a = await newStudent()
    const b = await newStudent()
    await prisma.user.update({ where: { id: a.id }, data: { campusEmail: 'mhs@binus.ac.id', campusEmailVerifiedAt: new Date() } })
    await expect(prisma.user.update({ where: { id: b.id }, data: { campusEmail: 'MHS@binus.ac.id', campusEmailVerifiedAt: new Date() } })).rejects.toThrow()
    // an unverified claim does not block anyone
    await prisma.user.update({ where: { id: b.id }, data: { campusEmail: 'mhs@binus.ac.id', campusEmailVerifiedAt: null } })
  })
})

describe('B13-004 / B13-003 / B13-002 response hardening', () => {
  it('sends security headers on API and health responses, and no-store on every RPC response', async () => {
    const health = await request('/api/health')
    expect(await health.json()).toEqual({ ok: true })
    expect((await request('/health')).status).toBe(200)
    expect(health.headers.get('x-frame-options')).toBe('DENY')
    expect(health.headers.get('x-content-type-options')).toBe('nosniff')
    expect(health.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(health.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    const rpc = await request('/api/trpc/kos.list')
    expect(rpc.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses an oversized RPC body before parsing it', async () => {
    const res = await request('/api/trpc/payment.start', { body: { invoiceId: 'x'.repeat(300 * 1024) } })
    expect(res.status).toBe(413)
  })
})

describe('PT-001 / PT-002 photo uploads', () => {
  async function ownerKos() {
    const o = await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: {} } }, include: { kos: true }, orderBy: { id: 'asc' } })
    return { userId: o.userId, kosId: o.kos[0].id }
  }
  const put = (url: string, type: string, body: Uint8Array) => Promise.resolve(app.request(url, { method: 'PUT', headers: { 'content-type': type }, body: body as never }))

  it('the fake storage only accepts a PUT to a URL it signed', async () => {
    const { userId, kosId } = await ownerKos()
    const bytes = new Uint8Array(32).fill(7)
    const p = await callerFor(userId).owner.image.presign({ kosId, contentType: 'image/webp', contentLength: bytes.byteLength, width: 800 })
    const unsigned = p.url.replace(/&?sig=[0-9a-f]+/, '')
    expect((await put(unsigned, 'image/webp', bytes)).status).toBe(403)
    const tampered = p.url.replace(/\/kos\/[^/]+\//, '/kos/another-kos/')
    expect((await put(tampered, 'image/webp', bytes)).status).toBe(403)
    expect(storage.has(p.key)).toBe(false)
    expect((await put(p.url, 'image/webp', bytes)).status).toBe(200)
  })

  it('confirm refuses a file whose bytes are not the declared image type, and removes it', async () => {
    const { userId, kosId } = await ownerKos()
    const c = callerFor(userId)
    const html = new TextEncoder().encode('<script>alert(1)</script><!-- padding to twelve bytes -->')
    const bad = await c.owner.image.presign({ kosId, contentType: 'image/webp', contentLength: html.byteLength, width: 800 })
    storage.put(bad.key, html, 'image/webp')
    expect(await code(c.owner.image.confirm({ kosId, key: bad.key, width: 800, height: 600, order: 0 }))).toBe('BAD_REQUEST')
    expect(storage.has(bad.key)).toBe(false)

    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4])
    const good = await c.owner.image.presign({ kosId, contentType: 'image/webp', contentLength: webp.byteLength, width: 800 })
    storage.put(good.key, webp, 'image/webp')
    expect((await c.owner.image.confirm({ kosId, key: good.key, width: 800, height: 600, order: 0 })).id).toBeTruthy()
  })
})

describe('B09-001 mail sends carry a stable idempotency key', () => {
  it('passes the outbox row id as the idempotency key, so a duplicate send is dropped by the provider', async () => {
    const sent: EmailMessage[] = []
    await enqueueEmail(prisma, { to: 'a@example.com', template: 'verify-email', payload: { name: 'A', url: 'https://kobo.test/v' } })
    const row = await prisma.emailOutbox.findFirstOrThrow({ where: { to: 'a@example.com' } })
    await drainOutbox(prisma, { send: async (m) => void sent.push(m) })
    expect(sent).toHaveLength(1)
    expect(sent[0].idempotencyKey).toBe(row.id)
    expect((await prisma.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SENT')
  })
})
