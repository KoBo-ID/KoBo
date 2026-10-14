import type { TRPCError } from '@trpc/server'
import { addDays, addMonths, formatReceiptNo, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { approveApplication, callerFor, caller, createPendingMockPayment, DEMO_STUDENT_ID, newStudent, prisma, settleMock, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const startDate = () => addDays(todayWIB(new Date()), 3)

describe('booking router', () => {
  it('does not expose a direct create mutation that bypasses owner approval', () => {
    expect('create' in caller.booking).toBe(false)
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
      data: {
        tenancyId: t.id,
        periodStart: new Date(`${addMonths(today, -1)}T00:00:00Z`),
        dueDate: new Date(`${addDays(today, -1)}T00:00:00Z`),
        amount: 1,
        rentAmount: 1,
        discountAmount: 0,
        applicationFeeAmount: 0,
        ownerReceivableAmount: 1,
        gatewayFeeBearer: 'PLATFORM',
        status: 'UNPAID',
      },
    })
    expect((await caller.kos.detail({ id: room.kosId })).rooms.find((r) => r.id === room.id)!.status).toBe('overdue')
  })
})

describe('booking.mine and payment.status', () => {
  it('lists my tenancies with kos, room, invoices and derived status', async () => {
    const room = await vacantRoom()
    const student = await newStudent()
    const c = callerFor(student.id)
    expect(await c.booking.mine()).toEqual([])
    const res = await approveApplication(student.id, room.id, { startDate: startDate(), durationMonths: 3 })

    const [pending] = await c.booking.mine()
    expect(pending).toMatchObject({ id: res.tenancyId, status: 'PENDING', derivedStatus: 'booking', durationMonths: 3, startDate: startDate() })
    expect(pending.kos).toMatchObject({ id: room.kosId, name: room.kos.name })
    expect(pending.room).toMatchObject({ id: room.id, roomNumber: room.roomNumber })
    expect(pending.invoices).toHaveLength(1)
    expect(pending.invoices[0]).toMatchObject({ status: 'UNPAID', dueDate: startDate(), amount: res.invoice.amount, receiptNo: null })
    expect(pending.invoices[0]).toMatchObject({ activePayment: null, latestPayment: null, canPay: true })

    const payment = await createPendingMockPayment(res.invoiceId)
    await settleMock(payment.id)
    const [active] = await c.booking.mine()
    expect(active).toMatchObject({ status: 'ACTIVE', derivedStatus: 'paid' })
    expect(active.invoices).toHaveLength(3)
    const paid = active.invoices.filter((i) => i.status === 'PAID')
    expect(paid).toHaveLength(1)
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(paid[0].receiptNo).toBe(formatReceiptNo(p.receiptNo, p.paidAt!))
    expect(paid[0].receiptNumber).toBe(p.receiptNo)
    expect(active.invoices.map((i) => i.dueDate)).toEqual([startDate(), addMonths(startDate(), 1), addMonths(startDate(), 2)])
    const storedInvoices = await prisma.invoice.findMany({ where: { tenancyId: res.tenancyId }, orderBy: { dueDate: 'asc' } })
    expect(storedInvoices.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: room.priceMonthly,
          rentAmount: room.priceMonthly,
          discountAmount: 0,
          applicationFeeAmount: 0,
          ownerReceivableAmount: room.priceMonthly,
          gatewayFeeBearer: 'PLATFORM',
        }),
      ]),
    )
  })

  it("never shows someone else's tenancies", async () => {
    const room = await vacantRoom()
    await approveApplication('user-student-3', room.id, { startDate: startDate(), durationMonths: 3 })
    const other = await newStudent()
    expect(await callerFor(other.id).booking.mine()).toEqual([])
  })

  it('payment.status is only visible to the payer', async () => {
    const room = await vacantRoom()
    const res = await approveApplication('user-student-3', room.id, { startDate: startDate(), durationMonths: 3 })
    const payment = await createPendingMockPayment(res.invoiceId)
    expect(await callerFor('user-student-3').payment.status({ paymentId: payment.id })).toMatchObject({ status: 'PENDING', tenancyStatus: 'PENDING', receiptNumber: null })
    expect((await err(callerFor('user-student-4').payment.status({ paymentId: payment.id })))?.code).toBe('NOT_FOUND')
    expect((await err(caller.payment.status({ paymentId: payment.id })))?.code).toBe('UNAUTHORIZED')
  })
})
