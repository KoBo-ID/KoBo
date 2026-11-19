import type { TRPCError } from '@trpc/server'
import { addDays, addMonths, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, cash, newStudent, prisma, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const today = () => todayWIB(new Date())
const startDate = () => addDays(today(), 3)

/** A vacant room plus its kos owner's user id. */
async function roomAndOwner(nth = 0) {
  const room = await vacantRoom(nth)
  const owner = await prisma.ownerProfile.findUniqueOrThrow({ where: { id: room.kos.ownerId }, select: { userId: true } })
  return { room, ownerId: owner.userId, kosId: room.kosId }
}

const verify = (userId: string) => prisma.user.update({ where: { id: userId }, data: { campus: 'BINUS', campusEmailVerifiedAt: new Date(), campusVerifiedUntil: new Date(Date.now() + 90 * 86_400_000) } })

describe('G2-01: an owner cannot rent, survey or review their own kos', () => {
  it('application.create is refused for the kos owner', async () => {
    const { room, ownerId } = await roomAndOwner()
    const e = await err(callerFor(ownerId).application.create({ roomId: room.id, startDate: startDate(), durationMonths: 3 }))
    expect(e?.code).toBe('FORBIDDEN')
    expect(e?.message).toBe('Anda tidak bisa menyewa kamar di kos Anda sendiri.')
    expect(await prisma.rentalApplication.count({ where: { userId: ownerId } })).toBe(0)
  })

  it('visit.create is refused for the kos owner', async () => {
    const { kosId, ownerId } = await roomAndOwner()
    const e = await err(callerFor(ownerId).visit.create({ kosId, date: addDays(today(), 2), timeSlot: 'PAGI' }))
    expect(e?.code).toBe('FORBIDDEN')
    expect(e?.message).toBe('Anda tidak bisa menjadwalkan survey di kos Anda sendiri.')
  })

  it('review.create is refused for a tenancy of the owner in their own kos (legacy rows)', async () => {
    const { room, ownerId } = await roomAndOwner()
    const t = await prisma.tenancy.create({ data: { roomId: room.id, userId: ownerId, status: 'ACTIVE', startDate: new Date(), durationMonths: 1 } })
    await prisma.invoice.create({ data: { tenancyId: t.id, periodStart: new Date(), dueDate: new Date(), amount: 1, rentAmount: 1, discountAmount: 0, applicationFeeAmount: 0, ownerReceivableAmount: 1, gatewayFeeBearer: 'PLATFORM', status: 'PAID' } })
    const e = await err(callerFor(ownerId).review.create({ tenancyId: t.id, rating: 5, subRatings: {}, comment: 'Kos terbaik, pemilik sangat ramah sekali.' }))
    expect(e?.code).toBe('FORBIDDEN')
    expect(e?.message).toBe('Anda tidak bisa mengulas kos Anda sendiri.')
  })
})

describe('G2-02: invoice #1 can never be Rp 0', () => {
  it('a discount at or above the rent is clamped so the first invoice stays payable, and approve -> pay works', async () => {
    const { room, ownerId, kosId } = await roomAndOwner()
    await prisma.kos.update({ where: { id: kosId }, data: { studentDiscountAmount: 5_000_000, applicationFee: 0 } })
    const student = await newStudent()
    await verify(student.id)
    const app = await callerFor(student.id).application.create({ roomId: room.id, startDate: startDate(), durationMonths: 3 })
    const dec = await callerFor(ownerId).application.decide({ kosId, applicationId: app.id, decision: 'APPROVE' })
    const invoices = await prisma.invoice.findMany({ where: { tenancyId: dec.tenancyId! }, orderBy: { dueDate: 'asc' } })
    expect(invoices[0].amount).toBeGreaterThan(0)
    expect(invoices[0].amount).toBe(invoices[0].ownerReceivableAmount + invoices[0].applicationFeeAmount)
    const paid = await callerFor(ownerId).payment.recordManual(await cash(kosId, invoices[0].id))
    expect(paid.receiptNumber).toBeGreaterThan(0)
    const t = await prisma.tenancy.findUniqueOrThrow({ where: { id: dec.tenancyId! }, include: { invoices: true } })
    expect(t.status).toBe('ACTIVE')
    expect(t.invoices).toHaveLength(3)
  })
})

describe('G2-03: lease end is exposed and prompts the owner', () => {
  it('booking.mine carries leaseEndDate; the owner board flags an ACTIVE tenancy whose lease ended', async () => {
    const { room, ownerId, kosId } = await roomAndOwner()
    const student = await newStudent()
    const start = addDays(today(), -100)
    const t = await prisma.tenancy.create({ data: { roomId: room.id, userId: student.id, status: 'ACTIVE', startDate: new Date(`${start}T00:00:00+07:00`), durationMonths: 3 } })
    await prisma.room.update({ where: { id: room.id }, data: { occupancy: 'OCCUPIED' } })
    const mine = (await callerFor(student.id).booking.mine()).find((x) => x.id === t.id)!
    expect(mine.leaseEndDate).toBe(addMonths(start, 3))
    const board = await callerFor(ownerId).owner.board({ kosId })
    const row = board.rooms.find((r) => r.id === room.id)!
    expect(row.leaseEndDate).toBe(addMonths(start, 3))
    expect(row.leaseEnded).toBe(true)
    expect(board.summary.leaseEndedCount).toBe(1)
    // The existing end path frees the room, which clears the prompt.
    await callerFor(ownerId).owner.tenancy.end({ kosId, tenancyId: t.id })
    const after = await callerFor(ownerId).owner.board({ kosId })
    expect(after.summary.leaseEndedCount).toBe(0)
  })

  it('a running lease is not flagged', async () => {
    const { room, ownerId, kosId } = await roomAndOwner()
    const student = await newStudent()
    await prisma.tenancy.create({ data: { roomId: room.id, userId: student.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 } })
    await prisma.room.update({ where: { id: room.id }, data: { occupancy: 'OCCUPIED' } })
    const board = await callerFor(ownerId).owner.board({ kosId })
    expect(board.rooms.find((r) => r.id === room.id)!.leaseEnded).toBe(false)
    expect(board.summary.leaseEndedCount).toBe(0)
  })
})

describe('G2-05: one live room per kos per student', () => {
  it('application.create is refused while the student rents (ACTIVE or live hold) another room of the same kos', async () => {
    const a = await roomAndOwner(0)
    const sibling = await prisma.room.findFirstOrThrow({ where: { kosId: a.kosId, id: { not: a.room.id }, tenancies: { none: { status: { in: ['ACTIVE', 'PENDING'] } } } } })
    const student = await newStudent()
    await prisma.tenancy.create({ data: { roomId: a.room.id, userId: student.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 } })
    const e = await err(callerFor(student.id).application.create({ roomId: sibling.id, startDate: startDate(), durationMonths: 3 }))
    expect(e?.code).toBe('BAD_REQUEST')
    expect(e?.message).toBe('Anda sudah menyewa kamar di kos ini.')
  })

  it('application.decide re-checks: the second of two pending applications cannot be approved once the first holds a room', async () => {
    const a = await roomAndOwner(0)
    const sibling = await prisma.room.findFirstOrThrow({ where: { kosId: a.kosId, id: { not: a.room.id }, tenancies: { none: { status: { in: ['ACTIVE', 'PENDING'] } } } } })
    const student = await newStudent()
    const c = callerFor(student.id)
    const first = await c.application.create({ roomId: a.room.id, startDate: startDate(), durationMonths: 3 })
    const second = await c.application.create({ roomId: sibling.id, startDate: startDate(), durationMonths: 3 })
    const owner = callerFor(a.ownerId)
    await owner.application.decide({ kosId: a.kosId, applicationId: first.id, decision: 'APPROVE' })
    const e = await err(owner.application.decide({ kosId: a.kosId, applicationId: second.id, decision: 'APPROVE' }))
    expect(e?.code).toBe('BAD_REQUEST')
    expect(e?.message).toBe('Penyewa ini sudah menyewa kamar lain di kos ini.')
    expect(await prisma.tenancy.count({ where: { userId: student.id } })).toBe(1)
  })
})

describe('S-2: a stale start date cannot be approved', () => {
  it('decide(APPROVE) refuses an application whose start date has passed', async () => {
    const { room, ownerId, kosId } = await roomAndOwner()
    const student = await newStudent()
    const app = await callerFor(student.id).application.create({ roomId: room.id, startDate: startDate(), durationMonths: 3 })
    await prisma.rentalApplication.update({ where: { id: app.id }, data: { startDate: new Date(`${addDays(today(), -2)}T00:00:00Z`) } })
    const e = await err(callerFor(ownerId).application.decide({ kosId, applicationId: app.id, decision: 'APPROVE' }))
    expect(e?.code).toBe('BAD_REQUEST')
    expect(e?.message).toContain('Tanggal mulai')
    expect(await prisma.tenancy.count({ where: { userId: student.id } })).toBe(0)
    // Rejecting a stale application is still possible.
    await callerFor(ownerId).application.decide({ kosId, applicationId: app.id, decision: 'REJECT' })
  })
})

describe('S-4: a past SCHEDULED visit does not block a new survey', () => {
  it('visit.create succeeds after the earlier visit date has passed, and the stale one is closed', async () => {
    const { kosId } = await roomAndOwner()
    const student = await newStudent()
    const c = callerFor(student.id)
    const old = await c.visit.create({ kosId, date: addDays(today(), 2), timeSlot: 'PAGI' })
    await prisma.visit.update({ where: { id: old.id }, data: { date: new Date(`${addDays(today(), -3)}T00:00:00Z`) } })
    const again = await err(c.visit.create({ kosId, date: addDays(today(), 2), timeSlot: 'SIANG' }))
    expect(again).toBeNull()
    const stale = await prisma.visit.findUniqueOrThrow({ where: { id: old.id } })
    expect(stale.status).not.toBe('SCHEDULED')
  })
})
