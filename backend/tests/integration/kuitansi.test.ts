import type { TRPCError } from '@trpc/server'
import { addDays, formatReceiptNo, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { approveApplication, caller, callerFor, createPendingMockPayment, DEMO_STUDENT_ID, prisma, vacantRoom, cash } from '../helpers.ts'

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
  })

  it('lets the owner of the kos read it', async () => {
    const { paid, ownerId } = await paidReceipt()
    expect((await callerFor(ownerId).kuitansi.get({ receiptNo: paid.receiptNumber })).receiptNumber).toBe(paid.receiptNumber)
  })

  it('reports MOCK for a simulated payment', async () => {
    const room = await vacantRoom()
    const student = callerFor(DEMO_STUDENT_ID, { isDemo: true })
    const booked = await approveApplication(DEMO_STUDENT_ID, room.id, { startDate: addDays(todayWIB(new Date()), 2), durationMonths: 2 })
    const payment = await createPendingMockPayment(booked.invoiceId)
    await student.payment.simulate({ paymentId: payment.id })
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect((await student.kuitansi.get({ receiptNo: pay.receiptNo })).method).toBe('MOCK')
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
