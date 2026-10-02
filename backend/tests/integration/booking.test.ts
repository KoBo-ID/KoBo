import type { TRPCError } from '@trpc/server'
import { addDays, addMonths, formatReceiptNo, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, caller, DEMO_STUDENT_ID, newStudent, postWebhook, prisma, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const startDate = () => addDays(todayWIB(new Date()), 3)

describe('booking.create', () => {
  it('rejects anonymous callers', async () => {
    const room = await vacantRoom()
    expect((await err(caller.booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 6 })))?.code).toBe('UNAUTHORIZED')
  })

  it('creates a PENDING tenancy (24h hold), invoice #1 and a MOCK PENDING payment, priced by the server', async () => {
    const room = await vacantRoom()
    const before = Date.now()
    // Any client-sent price is ignored: it is not even part of the input schema.
    const res = await callerFor(DEMO_STUDENT_ID).booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 6, amount: 1 } as never)

    const discount = Math.min(room.kos.studentDiscountAmount, room.priceMonthly + room.kos.applicationFee)
    expect(res.breakdown).toEqual({ rent: room.priceMonthly, applicationFee: room.kos.applicationFee, discount, total: room.priceMonthly + room.kos.applicationFee - discount })

    const tenancy = await prisma.tenancy.findUniqueOrThrow({ where: { id: res.tenancyId }, include: { invoices: { include: { payments: true } } } })
    expect(tenancy).toMatchObject({ roomId: room.id, userId: DEMO_STUDENT_ID, status: 'PENDING', durationMonths: 6 })
    const hold = tenancy.expiresAt!.getTime() - before
    expect(hold).toBeGreaterThan(24 * 3600_000 - 60_000)
    expect(hold).toBeLessThan(24 * 3600_000 + 60_000)
    expect(tenancy.invoices).toHaveLength(1)
    expect(tenancy.invoices[0]).toMatchObject({ amount: res.breakdown.total, status: 'UNPAID' })
    const [pay] = tenancy.invoices[0].payments
    expect(pay).toMatchObject({ provider: 'MOCK', status: 'PENDING', amount: res.breakdown.total })
    expect(pay.externalId).toBeTruthy()
    expect(res.payment).toMatchObject({ id: pay.id, externalId: pay.externalId, status: 'PENDING', amount: res.breakdown.total })
    expect(res.payment.instructions.bcaVa).toMatch(/^\d{10,}$/)
  })

  it('gives no campus discount to a student without a verified campus email', async () => {
    const room = await vacantRoom()
    const res = await callerFor('user-student-1').booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 3 })
    expect(res.breakdown.discount).toBe(0)
    expect(res.breakdown.total).toBe(room.priceMonthly + room.kos.applicationFee)
  })

  it('validates the room, the start date and the duration', async () => {
    const c = callerFor(DEMO_STUDENT_ID)
    const room = await vacantRoom()
    expect((await err(c.booking.create({ roomId: 'nope', startDate: startDate(), durationMonths: 6 })))?.code).toBe('NOT_FOUND')
    expect((await err(c.booking.create({ roomId: room.id, startDate: addDays(todayWIB(new Date()), -2), durationMonths: 6 })))?.code).toBe('BAD_REQUEST')
    expect((await err(c.booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 0 })))?.code).toBe('BAD_REQUEST')
    expect((await err(c.booking.create({ roomId: room.id, startDate: 'besok', durationMonths: 6 })))?.code).toBe('BAD_REQUEST')
  })

  it('refuses a room that is already held, with the Indonesian conflict message', async () => {
    const room = await vacantRoom()
    await callerFor(DEMO_STUDENT_ID).booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 6 })
    const e = await err(callerFor('user-student-1').booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 6 }))
    expect(e?.code).toBe('CONFLICT')
    expect(e?.message).toBe('Kamar baru saja dibooking orang lain.')
  })

  it('lets a new booking replace an expired hold (the stale tenancy is ended)', async () => {
    const room = await vacantRoom()
    const stale = await prisma.tenancy.create({
      data: { roomId: room.id, userId: 'user-student-2', status: 'PENDING', startDate: new Date(), durationMonths: 6, expiresAt: new Date(Date.now() - 60_000) },
    })
    const res = await callerFor(DEMO_STUDENT_ID).booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 6 })
    expect(res.tenancyId).not.toBe(stale.id)
    const after = await prisma.tenancy.findUniqueOrThrow({ where: { id: stale.id } })
    expect(after.status).toBe('ENDED')
    expect(after.endedAt).not.toBeNull()
  })

  it('does not touch an unexpired hold of the same room', async () => {
    const room = await vacantRoom()
    const first = await callerFor('user-student-2').booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 6 })
    await err(callerFor(DEMO_STUDENT_ID).booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 6 }))
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: first.tenancyId } })).status).toBe('PENDING')
  })
})

describe('room status reads (spec section 11)', () => {
  it('an expired hold reads as vacant in kos.detail and counts as available in kos.search', async () => {
    const room = await vacantRoom()
    const before = await caller.kos.detail({ id: room.kosId })
    const availBefore = (await caller.kos.search({})).find((k) => k.id === room.kosId)!.availableRooms

    const t = await prisma.tenancy.create({
      data: { roomId: room.id, userId: DEMO_STUDENT_ID, status: 'PENDING', startDate: new Date(), durationMonths: 6, expiresAt: new Date(Date.now() + 3600_000) },
    })
    expect((await caller.kos.detail({ id: room.kosId })).rooms.find((r) => r.id === room.id)!.status).toBe('booking')
    expect((await caller.kos.search({})).find((k) => k.id === room.kosId)!.availableRooms).toBe(availBefore - 1)

    await prisma.tenancy.update({ where: { id: t.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const after = await caller.kos.detail({ id: room.kosId })
    expect(after.rooms.find((r) => r.id === room.id)!.status).toBe('vacant')
    expect(after.availableRooms).toBe(before.availableRooms)
    expect((await caller.kos.search({})).find((k) => k.id === room.kosId)!.availableRooms).toBe(availBefore)
  })

  it('an ACTIVE tenancy whose invoice fell due yesterday (WIB) reads as overdue', async () => {
    const room = await vacantRoom()
    const today = todayWIB(new Date())
    const t = await prisma.tenancy.create({ data: { roomId: room.id, userId: DEMO_STUDENT_ID, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 } })
    await prisma.invoice.create({
      data: { tenancyId: t.id, periodStart: new Date(`${addMonths(today, -1)}T00:00:00Z`), dueDate: new Date(`${addDays(today, -1)}T00:00:00Z`), amount: 1, status: 'UNPAID' },
    })
    expect((await caller.kos.detail({ id: room.kosId })).rooms.find((r) => r.id === room.id)!.status).toBe('overdue')
  })
})

describe('booking.mine and payment.status', () => {
  it('lists my tenancies with kos, room, invoices and derived status', async () => {
    const room = await vacantRoom()
    const c = callerFor((await newStudent()).id)
    expect(await c.booking.mine()).toEqual([])
    const res = await c.booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 3 })

    const [pending] = await c.booking.mine()
    expect(pending).toMatchObject({ id: res.tenancyId, status: 'PENDING', derivedStatus: 'booking', durationMonths: 3, startDate: startDate() })
    expect(pending.kos).toMatchObject({ id: room.kosId, name: room.kos.name })
    expect(pending.room).toMatchObject({ id: room.id, roomNumber: room.roomNumber })
    expect(pending.invoices).toHaveLength(1)
    expect(pending.invoices[0]).toMatchObject({ status: 'UNPAID', dueDate: startDate(), amount: res.breakdown.total, receiptNo: null })
    expect(pending.pendingPaymentId).toBe(res.payment.id)

    await postWebhook({ externalId: res.payment.externalId, status: 'PAID' })
    const [active] = await c.booking.mine()
    expect(active).toMatchObject({ status: 'ACTIVE', derivedStatus: 'paid', pendingPaymentId: null })
    expect(active.invoices).toHaveLength(3)
    const paid = active.invoices.filter((i) => i.status === 'PAID')
    expect(paid).toHaveLength(1)
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: res.payment.id } })
    expect(paid[0].receiptNo).toBe(formatReceiptNo(p.receiptNo, p.paidAt!))
    expect(paid[0].receiptNumber).toBe(p.receiptNo)
    expect(active.invoices.map((i) => i.dueDate)).toEqual([startDate(), addMonths(startDate(), 1), addMonths(startDate(), 2)])
  })

  it("never shows someone else's tenancies", async () => {
    const room = await vacantRoom()
    await callerFor('user-student-3').booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 3 })
    const other = await newStudent()
    expect(await callerFor(other.id).booking.mine()).toEqual([])
  })

  it('payment.status is only visible to the payer', async () => {
    const room = await vacantRoom()
    const res = await callerFor('user-student-3').booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 3 })
    expect(await callerFor('user-student-3').payment.status({ paymentId: res.payment.id })).toMatchObject({ status: 'PENDING', tenancyStatus: 'PENDING', receiptNumber: null })
    expect((await err(callerFor('user-student-4').payment.status({ paymentId: res.payment.id })))?.code).toBe('NOT_FOUND')
    expect((await err(caller.payment.status({ paymentId: res.payment.id })))?.code).toBe('UNAUTHORIZED')
  })
})
