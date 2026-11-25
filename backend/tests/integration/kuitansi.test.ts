import type { TRPCError } from '@trpc/server'
import { addDays, addMonths, formatReceiptNo, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { applyPaymentEventTx } from '../../src/payment/settlement.ts'
import { approveApplication, caller, callerFor, createPendingMockPayment, DEMO_STUDENT_ID, newStudent, prisma, TEST_BUSINESS_ID, vacantRoom, cash } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code
const ownerUserOf = async (kosId: string) => (await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: kosId } } } })).userId

/** A paid kuitansi: the demo student books and the owner marks invoice 1 paid (MANUAL). */
async function paidReceipt() {
  const room = await vacantRoom()
  const booked = await approveApplication(DEMO_STUDENT_ID, room.id, { startDate: addDays(todayWIB(new Date()), 2), durationMonths: 3 })
  const ownerId = await ownerUserOf(room.kosId)
  const paid = await callerFor(ownerId).payment.recordManual(await cash(room.kosId, booked.invoiceId))
  return { room, booked, paid, ownerId }
}

describe('kuitansi.get', () => {
  it('lets the paying tenant read everything the receipt shows', async () => {
    const { room, booked, paid } = await paidReceipt()
    const k = await callerFor(DEMO_STUDENT_ID).kuitansi.get({ receiptNo: paid.receiptNumber })
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paid.paymentId } })
    expect(k).toMatchObject({
      receiptNumber: paid.receiptNumber,
      receiptNo: formatReceiptNo(paid.receiptNumber, pay.paidAt!),
      method: 'MANUAL',
      amount: booked.invoice.amount,
      payer: { name: 'Dimas Pratama' },
      kos: { id: room.kosId, name: room.kos.name },
      room: { roomNumber: room.roomNumber },
    })
    expect(k.paidAt).toBe(pay.paidAt!.toISOString())
    expect(k.period.dueDate).toBe(addDays(todayWIB(new Date()), 2))
    expect(k.owner.name).toBeTruthy()
    expect(k.status).toBe('PAID')
    expect(k.breakdown.total).toBe(booked.invoice.amount)
    expect(k.breakdown.rent + k.breakdown.applicationFee - k.breakdown.discount).toBe(k.breakdown.total)
    expect(k.period.periodEnd).toBe(addDays(addMonths(k.period.periodStart, 1), -1))
    expect(k.kos.city).toBeTruthy()
    expect(k.reference).toBeNull()
  })

  it('shows a refunded receipt as REFUNDED, and keeps a refund-in-progress one PAID', async () => {
    const { paid, ownerId } = await paidReceipt()
    await prisma.payment.update({ where: { id: paid.paymentId }, data: { status: 'REFUND_PENDING' } })
    expect((await callerFor(ownerId).kuitansi.get({ receiptNo: paid.receiptNumber })).status).toBe('PAID')
    await prisma.payment.update({ where: { id: paid.paymentId }, data: { status: 'REFUNDED', refundedAt: new Date() } })
    expect((await callerFor(ownerId).kuitansi.get({ receiptNo: paid.receiptNumber })).status).toBe('REFUNDED')
  })

  it('lets the owner of the kos read it', async () => {
    const { paid, ownerId } = await paidReceipt()
    expect((await callerFor(ownerId).kuitansi.get({ receiptNo: paid.receiptNumber })).receiptNumber).toBe(paid.receiptNumber)
  })

  it('reports MOCK for a simulated payment without leaking internal mock payment ids', async () => {
    const room = await vacantRoom()
    const student = callerFor(DEMO_STUDENT_ID, { isDemo: true })
    const booked = await approveApplication(DEMO_STUDENT_ID, room.id, { startDate: addDays(todayWIB(new Date()), 2), durationMonths: 2 })
    const payment = await createPendingMockPayment(booked.invoiceId)
    await student.payment.simulate({ paymentId: payment.id })
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    const k = await student.kuitansi.get({ receiptNo: pay.receiptNo })
    expect(k.method).toBe('MOCK')
    expect(k.reference).toBeNull()
  })

  it('exposes the Xendit payment reference on a settled Xendit receipt', async () => {
    const room = await vacantRoom()
    const student = await newStudent()
    const booked = await approveApplication(student.id, room.id, { startDate: addDays(todayWIB(new Date()), 2), durationMonths: 2 })
    const p = await prisma.payment.create({
      data: { invoiceId: booked.invoiceId, provider: 'XENDIT', status: 'PENDING', amount: booked.invoice.amount, providerSessionId: 'ps_kui', providerBusinessId: TEST_BUSINESS_ID },
    })
    await applyPaymentEventTx(prisma, { provider: 'XENDIT', expectedBusinessId: TEST_BUSINESS_ID }, {
      kind: 'SESSION_COMPLETED', referenceId: p.id, providerBusinessId: TEST_BUSINESS_ID, amount: booked.invoice.amount, currency: 'IDR', occurredAt: new Date(),
      providerSessionId: 'ps_kui', providerPaymentRequestId: 'pr_kui_1', providerPaymentId: 'py_kui_1',
    })
    const k = await callerFor(student.id).kuitansi.get({ receiptNo: p.receiptNo })
    expect(k.method).toBe('XENDIT')
    expect(k.reference).toBe('py_kui_1')
  })

  it('refuses a kuitansi for an unfulfilled late or duplicate refund payment', async () => {
    const room = await vacantRoom()
    const student = await newStudent()
    const booked = await approveApplication(student.id, room.id, { startDate: addDays(todayWIB(new Date()), 2), durationMonths: 2 })
    await prisma.tenancy.update({ where: { id: booked.tenancyId }, data: { expiresAt: new Date(Date.now() - 60_000) } })
    const late = await prisma.payment.create({
      data: { invoiceId: booked.invoiceId, provider: 'XENDIT', status: 'PENDING', amount: booked.invoice.amount, providerSessionId: 'ps_late_kui', providerBusinessId: TEST_BUSINESS_ID },
    })
    await applyPaymentEventTx(prisma, { provider: 'XENDIT', expectedBusinessId: TEST_BUSINESS_ID }, {
      kind: 'SESSION_COMPLETED', referenceId: late.id, providerBusinessId: TEST_BUSINESS_ID, amount: booked.invoice.amount, currency: 'IDR', occurredAt: new Date(),
      providerSessionId: 'ps_late_kui', providerPaymentRequestId: 'pr_late_kui', providerPaymentId: 'py_late_kui',
    })
    expect(await code(callerFor(student.id).kuitansi.get({ receiptNo: late.receiptNo }))).toBe('NOT_FOUND')

    // Duplicate second payment on an already-PAID invoice also gets no receipt of its own.
    const { booked: paidBooked, ownerId } = await paidReceipt()
    const dup = await prisma.payment.create({
      data: { invoiceId: paidBooked.invoiceId, provider: 'XENDIT', status: 'PENDING', amount: paidBooked.invoice.amount, providerSessionId: 'ps_dup_kui', providerBusinessId: TEST_BUSINESS_ID },
    })
    await applyPaymentEventTx(prisma, { provider: 'XENDIT', expectedBusinessId: TEST_BUSINESS_ID }, {
      kind: 'SESSION_COMPLETED', referenceId: dup.id, providerBusinessId: TEST_BUSINESS_ID, amount: paidBooked.invoice.amount, currency: 'IDR', occurredAt: new Date(),
      providerSessionId: 'ps_dup_kui', providerPaymentRequestId: 'pr_dup_kui', providerPaymentId: 'py_dup_kui',
    })
    expect(await code(callerFor(ownerId).kuitansi.get({ receiptNo: dup.receiptNo }))).toBe('NOT_FOUND')
  })

  it('refuses any other signed-in user and another owner with NOT_FOUND (same as a missing receipt)', async () => {
    const { room, paid } = await paidReceipt()
    expect(await code(callerFor('user-student-5').kuitansi.get({ receiptNo: paid.receiptNumber }))).toBe('NOT_FOUND')
    const other = await prisma.ownerProfile.findFirstOrThrow({ where: { id: { not: room.kos.ownerId } } })
    expect(await code(callerFor(other.userId).kuitansi.get({ receiptNo: paid.receiptNumber }))).toBe('NOT_FOUND')
  })

  it('is NOT_FOUND for an unknown number and for a payment that is not paid', async () => {
    const room = await vacantRoom()
    const booked = await approveApplication(DEMO_STUDENT_ID, room.id, { startDate: addDays(todayWIB(new Date()), 2), durationMonths: 2 })
    const pending = await createPendingMockPayment(booked.invoiceId)
    expect(await code(callerFor(DEMO_STUDENT_ID).kuitansi.get({ receiptNo: 999999 }))).toBe('NOT_FOUND')
    expect(await code(callerFor(DEMO_STUDENT_ID).kuitansi.get({ receiptNo: pending.receiptNo }))).toBe('NOT_FOUND')
  })

  it('requires a session', async () => {
    const { paid } = await paidReceipt()
    expect(await code(caller.kuitansi.get({ receiptNo: paid.receiptNumber }))).toBe('UNAUTHORIZED')
  })
})
