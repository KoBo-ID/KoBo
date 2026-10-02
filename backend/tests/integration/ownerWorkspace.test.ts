import type { TRPCError } from '@trpc/server'
import { addDays, haversineMeters, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, DEMO_STUDENT_ID, newStudent, postWebhook, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const code = async (p: Promise<unknown>) => (await err(p))?.code

async function twoOwners() {
  const owners = await prisma.ownerProfile.findMany({ include: { kos: { orderBy: { createdAt: 'asc' } }, user: true }, orderBy: { id: 'asc' } })
  const [a, b] = owners.filter((o) => o.kos.length > 0)
  return { a, b }
}

const kosInput = (over: Record<string, unknown> = {}) => ({
  name: 'Kost Uji Coba',
  gender: 'CAMPUR' as const,
  address: 'Jl. Uji No. 1',
  district: 'Kemanggisan',
  city: 'Jakarta Barat',
  lat: -6.2005,
  lng: 106.7855,
  electricityType: 'TOKEN' as const,
  privateAmenities: ['AC'],
  sharedAmenities: ['Wi-Fi'],
  studentDiscountAmount: 100000,
  ...over,
})
const roomInput = (over: Record<string, unknown> = {}) => ({ roomNumber: 'Z99', floor: 2, type: 'Standar', size: '3 x 3 m', bedType: 'Single', priceMonthly: 1_000_000, ...over })

describe('owner.myKos', () => {
  it("lists only the caller's kos with computed counts, and rejects non-owners", async () => {
    const { a, b } = await twoOwners()
    const mine = await callerFor(a.userId).owner.myKos()
    expect(mine.map((k) => k.id).sort()).toEqual(a.kos.map((k) => k.id).sort())
    expect(mine.some((k) => b.kos.some((x) => x.id === k.id))).toBe(false)
    const k = mine[0]
    expect(k.totalRooms).toBe(await prisma.room.count({ where: { kosId: k.id } }))
    expect(k.occupiedRooms).toBeLessThanOrEqual(k.totalRooms)
    expect(await code(callerFor(DEMO_STUDENT_ID).owner.myKos())).toBe('FORBIDDEN')
  })
})

describe('owner.board', () => {
  it('derives each room status, tenant, oldest unpaid invoice and days overdue', async () => {
    const { a } = await twoOwners()
    const kosId = 'kos-1'
    expect(a.kos.some((k) => k.id === kosId)).toBe(true)
    const board = await callerFor(a.userId).owner.board({ kosId })
    expect(board.rooms).toHaveLength(await prisma.room.count({ where: { kosId } }))
    const overdue = board.rooms.find((r) => r.status === 'overdue')!
    expect(overdue.tenant?.name).toBeTruthy()
    expect(overdue.invoice).toMatchObject({ amount: overdue.priceMonthly })
    expect(overdue.daysOverdue).toBeGreaterThan(0)
    const vacant = board.rooms.find((r) => r.status === 'vacant')!
    expect(vacant.tenant).toBeNull()
    expect(vacant.invoice).toBeNull()
    expect(board.rooms.find((r) => r.status === 'booking')?.tenant).not.toBeNull()
    const paid = board.rooms.find((r) => r.status === 'paid')!
    expect(paid.lastReceipt?.receiptNo).toMatch(/^KB\/\d{4}\/\d{2}\/\d{4}$/)
    const s = board.summary
    expect(s.counts.paid + s.counts.due + s.counts.overdue + s.counts.vacant + s.counts.booking).toBe(board.rooms.length)
    expect(s.totalRooms).toBe(board.rooms.length)
    expect(s.occupiedRooms).toBe(board.rooms.length - s.counts.vacant)
  })

  it('reads an expired PENDING hold as vacant', async () => {
    const { a } = await twoOwners()
    const booking = (await callerFor(a.userId).owner.board({ kosId: 'kos-1' })).rooms.find((r) => r.status === 'booking')!
    await prisma.tenancy.update({ where: { id: booking.tenancyId! }, data: { expiresAt: new Date(Date.now() - 60_000) } })
    const after = (await callerFor(a.userId).owner.board({ kosId: 'kos-1' })).rooms.find((r) => r.id === booking.id)!
    expect(after.status).toBe('vacant')
    expect(after.tenant).toBeNull()
  })

  it('summarises expected versus collected rent for the current month', async () => {
    const { a } = await twoOwners()
    const today = todayWIB(new Date())
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
    const nextMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1))
    const inMonth = await prisma.invoice.findMany({
      where: { dueDate: { gte: monthStart, lt: nextMonth }, tenancy: { room: { kosId: 'kos-1' } }, OR: [{ status: 'PAID' }, { tenancy: { status: 'ACTIVE' } }] },
    })
    const board = await callerFor(a.userId).owner.board({ kosId: 'kos-1' })
    expect(board.summary.expectedThisMonth).toBe(inMonth.reduce((s, i) => s + i.amount, 0))
    expect(board.summary.collectedThisMonth).toBe(inMonth.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amount, 0))
    expect(board.summary.collectedThisMonth).toBeLessThanOrEqual(board.summary.expectedThisMonth)
    const overdueSum = board.rooms.filter((r) => r.status === 'overdue').reduce((s, r) => s + (r.invoice?.amount ?? 0), 0)
    expect(board.summary.overdueAmount).toBeGreaterThanOrEqual(overdueSum)
  })

  it("rejects another owner's kos and non-owners", async () => {
    const { a, b } = await twoOwners()
    expect(await code(callerFor(b.userId).owner.board({ kosId: a.kos[0].id }))).toBe('FORBIDDEN')
    expect(await code(callerFor(DEMO_STUDENT_ID).owner.board({ kosId: a.kos[0].id }))).toBe('FORBIDDEN')
  })
})

describe('owner.kos.create / update / delete', () => {
  it('creates a kos with the nearest campus computed by haversine, a unique slug, an image and starter rooms', async () => {
    const { a } = await twoOwners()
    const owner = callerFor(a.userId)
    const k = await owner.owner.kos.create(kosInput({ imageUrl: 'https://example.com/a.jpg', initialRooms: { count: 6, priceMonthly: 1_500_000 } }))
    const row = await prisma.kos.findUniqueOrThrow({ where: { id: k.id }, include: { rooms: true, images: true } })
    expect(row.ownerId).toBe(a.id)
    expect(row.rooms).toHaveLength(6)
    expect(row.rooms.every((r) => r.priceMonthly === 1_500_000 && r.occupancy === 'VACANT')).toBe(true)
    expect(new Set(row.rooms.map((r) => r.roomNumber)).size).toBe(6)
    expect(row.images.map((i) => i.url)).toEqual(['https://example.com/a.jpg'])
    expect(row.applicationFee).toBe(25000)
    const campuses = await prisma.campus.findMany()
    const nearest = campuses.map((c) => ({ c, d: haversineMeters({ lat: -6.2005, lng: 106.7855 }, { lat: c.lat, lng: c.lng }) })).sort((x, y) => x.d - y.d)[0]
    expect(row.nearestCampusId).toBe(nearest.c.id)
    expect(row.nearestCampusMeters).toBe(nearest.d)
    const second = await owner.owner.kos.create(kosInput())
    expect((await prisma.kos.findUniqueOrThrow({ where: { id: second.id } })).slug).not.toBe(row.slug)
    expect((await owner.owner.myKos()).some((x) => x.id === k.id)).toBe(true)
  })

  it('leaves the nearest campus empty when none is close', async () => {
    const { a } = await twoOwners()
    const k = await callerFor(a.userId).owner.kos.create(kosInput({ lat: -7.25, lng: 112.75 }))
    const row = await prisma.kos.findUniqueOrThrow({ where: { id: k.id } })
    expect(row.nearestCampusId).toBeNull()
    expect(row.nearestCampusMeters).toBeNull()
  })

  it('validates input and refuses non-owners', async () => {
    const { a } = await twoOwners()
    expect(await code(callerFor(a.userId).owner.kos.create(kosInput({ name: '' })))).toBe('BAD_REQUEST')
    expect(await code(callerFor(a.userId).owner.kos.create(kosInput({ lat: 123 })))).toBe('BAD_REQUEST')
    expect(await code(callerFor(DEMO_STUDENT_ID).owner.kos.create(kosInput()))).toBe('FORBIDDEN')
  })

  it('updates a kos and recomputes the campus only when the location moves', async () => {
    const { a } = await twoOwners()
    const owner = callerFor(a.userId)
    const before = await prisma.kos.findUniqueOrThrow({ where: { id: 'kos-1' } })
    await owner.owner.kos.update({ ...kosInput({ name: 'Nama Baru', lat: before.lat, lng: before.lng }), kosId: 'kos-1' })
    const same = await prisma.kos.findUniqueOrThrow({ where: { id: 'kos-1' } })
    expect(same.name).toBe('Nama Baru')
    expect(same.nearestCampusMeters).toBe(before.nearestCampusMeters)
    expect(same.slug).toBe(before.slug)
    await owner.owner.kos.update({ ...kosInput({ lat: -6.8925, lng: 107.6115 }), kosId: 'kos-1' })
    expect((await prisma.kos.findUniqueOrThrow({ where: { id: 'kos-1' } })).nearestCampusId).toBe('itb-ganesha')
  })

  it("rejects updating or deleting another owner's kos (cross-owner)", async () => {
    const { a, b } = await twoOwners()
    const victim = b.kos[0]
    const before = await prisma.kos.findUniqueOrThrow({ where: { id: victim.id } })
    expect(await code(callerFor(a.userId).owner.kos.update({ ...kosInput({ name: 'Dibajak' }), kosId: victim.id }))).toBe('FORBIDDEN')
    expect(await code(callerFor(a.userId).owner.kos.delete({ kosId: victim.id }))).toBe('FORBIDDEN')
    expect((await prisma.kos.findUniqueOrThrow({ where: { id: victim.id } })).name).toBe(before.name)
  })

  it('deletes an empty kos, but refuses while a PENDING or ACTIVE tenancy exists', async () => {
    const { b } = await twoOwners() // owner-1 is the demo owner, who may never delete
    const owner = callerFor(b.userId)
    const e = await err(owner.owner.kos.delete({ kosId: b.kos[0].id }))
    expect(e?.code).toBe('CONFLICT')
    expect(e?.message).toMatch(/sewa/i)
    expect(await prisma.kos.count({ where: { id: b.kos[0].id } })).toBe(1)

    const k = await owner.owner.kos.create(kosInput({ initialRooms: { count: 2, priceMonthly: 1_000_000 } }))
    await owner.owner.kos.delete({ kosId: k.id })
    expect(await prisma.kos.count({ where: { id: k.id } })).toBe(0)
    expect(await prisma.room.count({ where: { kosId: k.id } })).toBe(0)
  })

  it('a live PENDING hold blocks deletion, an expired hold no longer does', async () => {
    const { b } = await twoOwners()
    const owner = callerFor(b.userId)
    const k = await owner.owner.kos.create(kosInput({ initialRooms: { count: 1, priceMonthly: 1_000_000 } }))
    const room = await prisma.room.findFirstOrThrow({ where: { kosId: k.id } })
    const res = await callerFor(DEMO_STUDENT_ID).booking.create({ roomId: room.id, startDate: addDays(todayWIB(new Date()), 2), durationMonths: 3 })
    expect(await code(owner.owner.kos.delete({ kosId: k.id }))).toBe('CONFLICT')
    await prisma.tenancy.update({ where: { id: res.tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await owner.owner.kos.delete({ kosId: k.id })
    expect(await prisma.kos.count({ where: { id: k.id } })).toBe(0)
  })

  it('blocks demo users from deleting a kos (spec section 5)', async () => {
    const demo = await prisma.user.findUniqueOrThrow({ where: { email: 'demo-owner@kobo.test' } })
    const owner = callerFor(demo.id)
    const k = await owner.owner.kos.create(kosInput())
    expect(await code(owner.owner.kos.delete({ kosId: k.id }))).toBe('FORBIDDEN')
    expect(await prisma.kos.count({ where: { id: k.id } })).toBe(1)
  })
})

describe('owner.room.create / update / delete', () => {
  it('creates, updates and deletes a room of the own kos', async () => {
    const { a } = await twoOwners()
    const owner = callerFor(a.userId)
    const r = await owner.owner.room.create({ ...roomInput(), kosId: 'kos-1' })
    expect(await prisma.room.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ kosId: 'kos-1', roomNumber: 'Z99', occupancy: 'VACANT' })
    await owner.owner.room.update({ ...roomInput({ priceMonthly: 2_000_000, roomNumber: 'Z98' }), kosId: 'kos-1', roomId: r.id })
    expect(await prisma.room.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ priceMonthly: 2_000_000, roomNumber: 'Z98' })
    await owner.owner.room.delete({ kosId: 'kos-1', roomId: r.id })
    expect(await prisma.room.count({ where: { id: r.id } })).toBe(0)
  })

  it('rejects a duplicate room number with CONFLICT and a bad price with BAD_REQUEST', async () => {
    const { a } = await twoOwners()
    const owner = callerFor(a.userId)
    const existing = await prisma.room.findFirstOrThrow({ where: { kosId: 'kos-1' } })
    expect(await code(owner.owner.room.create({ ...roomInput({ roomNumber: existing.roomNumber }), kosId: 'kos-1' }))).toBe('CONFLICT')
    expect(await code(owner.owner.room.create({ ...roomInput({ priceMonthly: -1 }), kosId: 'kos-1' }))).toBe('BAD_REQUEST')
  })

  it("rejects another owner's kos and a room that belongs to a different kos (cross-owner)", async () => {
    const { a, b } = await twoOwners()
    const victimRoom = await prisma.room.findFirstOrThrow({ where: { kosId: b.kos[0].id } })
    expect(await code(callerFor(a.userId).owner.room.create({ ...roomInput(), kosId: b.kos[0].id }))).toBe('FORBIDDEN')
    expect(await code(callerFor(a.userId).owner.room.update({ ...roomInput({ priceMonthly: 1 }), kosId: b.kos[0].id, roomId: victimRoom.id }))).toBe('FORBIDDEN')
    expect(await code(callerFor(a.userId).owner.room.delete({ kosId: b.kos[0].id, roomId: victimRoom.id }))).toBe('FORBIDDEN')
    // own kosId (passes the guard) but the victim's room id
    expect(await code(callerFor(a.userId).owner.room.update({ ...roomInput(), kosId: 'kos-1', roomId: victimRoom.id }))).toBe('NOT_FOUND')
    expect(await code(callerFor(a.userId).owner.room.delete({ kosId: 'kos-1', roomId: victimRoom.id }))).toBe('NOT_FOUND')
    expect(await prisma.room.count({ where: { id: victimRoom.id } })).toBe(1)
  })

  it('refuses to delete a room with an ACTIVE or live PENDING tenancy', async () => {
    const { a } = await twoOwners()
    const owner = callerFor(a.userId)
    const board = await owner.owner.board({ kosId: 'kos-1' })
    for (const status of ['paid', 'booking'] as const) {
      const room = board.rooms.find((r) => r.status === status)!
      expect((await err(owner.owner.room.delete({ kosId: 'kos-1', roomId: room.id })))?.code).toBe('CONFLICT')
      expect(await prisma.room.count({ where: { id: room.id } })).toBe(1)
    }
  })
})

describe('owner.tenancy.end', () => {
  it('ends an ACTIVE tenancy: the room becomes vacant and bookable again', async () => {
    const { a } = await twoOwners()
    const owner = callerFor(a.userId)
    const room = (await owner.owner.board({ kosId: 'kos-1' })).rooms.find((r) => r.status === 'paid')!
    await owner.owner.tenancy.end({ kosId: 'kos-1', tenancyId: room.tenancyId! })
    const t = await prisma.tenancy.findUniqueOrThrow({ where: { id: room.tenancyId! } })
    expect(t.status).toBe('ENDED')
    expect(t.endedAt).not.toBeNull()
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).occupancy).toBe('VACANT')
    expect((await owner.owner.board({ kosId: 'kos-1' })).rooms.find((r) => r.id === room.id)!.status).toBe('vacant')
    expect(await code(owner.owner.tenancy.end({ kosId: 'kos-1', tenancyId: room.tenancyId! }))).toBe('CONFLICT')
    const s = await newStudent()
    await callerFor(s.id).booking.create({ roomId: room.id, startDate: addDays(todayWIB(new Date()), 2), durationMonths: 2 })
  })

  it('cancels a booking hold and neutralises its pending payment', async () => {
    const { a } = await twoOwners()
    const owner = callerFor(a.userId)
    const room = (await owner.owner.board({ kosId: 'kos-1' })).rooms.find((r) => r.status === 'booking')!
    const pay = await prisma.payment.findFirstOrThrow({ where: { invoice: { tenancyId: room.tenancyId! }, status: 'PENDING' } })
    await owner.owner.tenancy.end({ kosId: 'kos-1', tenancyId: room.tenancyId! })
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe('FAILED')
    expect((await postWebhook({ externalId: pay.externalId, status: 'PAID' })).status).toBe(200)
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: room.tenancyId! } })).status).toBe('ENDED')
    expect((await prisma.invoice.findFirstOrThrow({ where: { tenancyId: room.tenancyId! } })).status).toBe('UNPAID')
  })

  it("rejects another owner's tenancy (cross-owner)", async () => {
    const { a, b } = await twoOwners()
    const room = (await callerFor(a.userId).owner.board({ kosId: 'kos-1' })).rooms.find((r) => r.status === 'paid')!
    expect(await code(callerFor(b.userId).owner.tenancy.end({ kosId: 'kos-1', tenancyId: room.tenancyId! }))).toBe('FORBIDDEN')
    expect(await code(callerFor(b.userId).owner.tenancy.end({ kosId: b.kos[0].id, tenancyId: room.tenancyId! }))).toBe('NOT_FOUND')
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: room.tenancyId! } })).status).toBe('ACTIVE')
  })
})

describe('Tandai Lunas through the board', () => {
  it('payment.recordManual turns an overdue room into paid and exposes the receipt', async () => {
    const { a } = await twoOwners()
    const owner = callerFor(a.userId)
    const room = (await owner.owner.board({ kosId: 'kos-1' })).rooms.find((r) => r.status === 'overdue')!
    const out = await owner.payment.recordManual({ kosId: 'kos-1', invoiceId: room.invoice!.id })
    const after = (await owner.owner.board({ kosId: 'kos-1' })).rooms.find((r) => r.id === room.id)!
    expect(after.status).toBe('paid')
    expect(after.lastReceipt).toEqual({ receiptNumber: out.receiptNumber, receiptNo: out.receiptNo })
  })
})
