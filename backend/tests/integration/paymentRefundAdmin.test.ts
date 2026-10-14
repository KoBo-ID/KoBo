import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import type { PaymentProvider } from '../../src/payment/provider.ts'
import { drainPaymentRefunds, listStuckRefunds, requeueRefund, resolveRefund } from '../../src/payment/refunds.ts'
import { PaymentService } from '../../src/payment/service.ts'
import { XenditError } from '../../src/payment/xendit.ts'
import { approveApplication, newStudent, prisma, TEST_BUSINESS_ID, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

async function queued() {
  const student = await newStudent()
  const room = await vacantRoom()
  const { invoiceId, invoice } = await approveApplication(student.id, room.id)
  const payment = await prisma.payment.create({
    data: {
      invoiceId,
      provider: 'XENDIT',
      status: 'REFUND_PENDING',
      amount: invoice.amount,
      providerSessionId: `ps_${invoiceId}`,
      providerBusinessId: TEST_BUSINESS_ID,
      providerPaymentRequestId: `pr_${invoiceId}`,
      providerPaymentId: `py_${invoiceId}`,
    },
  })
  const refund = await prisma.paymentRefund.create({ data: { paymentId: payment.id, referenceId: `refund_${payment.id}`, amount: payment.amount, reason: 'HOLD_EXPIRED' } })
  return { payment, refund }
}

const serviceWith = (createRefund: PaymentProvider['createRefund']) =>
  new PaymentService({ defaultProvider: { kind: 'XENDIT', createCheckout: vi.fn(), getSession: vi.fn(), createRefund } })

describe('refund operator tooling', () => {
  it('lists failed refunds and refunds submitted long ago, but not fresh ones', async () => {
    const { payment, refund } = await queued()
    expect(await listStuckRefunds(prisma)).toHaveLength(0)
    await prisma.paymentRefund.update({ where: { id: refund.id }, data: { status: 'SUBMITTED', submittedAt: new Date(Date.now() - 2 * 24 * 3600_000) } })
    expect((await listStuckRefunds(prisma)).map((r) => r.paymentId)).toEqual([payment.id])
    await prisma.paymentRefund.update({ where: { id: refund.id }, data: { submittedAt: new Date() } })
    expect(await listStuckRefunds(prisma)).toHaveLength(0)
  })

  it('resolves a stuck submitted refund once the dashboard shows the outcome', async () => {
    const { payment, refund } = await queued()
    await prisma.paymentRefund.update({ where: { id: refund.id }, data: { status: 'SUBMITTED', submittedAt: new Date(Date.now() - 2 * 24 * 3600_000) } })
    expect((await resolveRefund(prisma, refund.id, 'SUCCEEDED')).outcome).toBe('REFUNDED')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUNDED')
    expect((await resolveRefund(prisma, refund.id, 'SUCCEEDED')).outcome).toBe('DUPLICATE')
  })

  it('re-queues a failed refund under a fresh reference only after explicit confirmation, then submits it', async () => {
    const { payment, refund } = await queued()
    const createRefund = vi
      .fn()
      .mockRejectedValueOnce(new XenditError('CREATE_REFUND', 400, 'INSUFFICIENT_BALANCE', false, false, 'x'))
      .mockResolvedValue({ providerRefundId: 'rfd-2', state: 'PENDING', updatedAt: new Date() })
    const svc = serviceWith(createRefund)
    expect(await drainPaymentRefunds(prisma, svc)).toMatchObject({ failed: 1 })
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUND_FAILED')

    await expect(requeueRefund(prisma, refund.id, { confirmNotRefunded: false })).rejects.toThrow(/Confirm/)
    const { referenceId } = await requeueRefund(prisma, refund.id, { confirmNotRefunded: true })
    expect(referenceId).not.toBe(`refund_${payment.id}`)
    expect(referenceId.startsWith(`refund_${payment.id}_`)).toBe(true)
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: 'REFUND_PENDING', failureCode: null })

    expect(await drainPaymentRefunds(prisma, svc)).toMatchObject({ submitted: 1 })
    expect(createRefund.mock.calls[1][0].referenceId).toBe(referenceId)
    await expect(requeueRefund(prisma, refund.id, { confirmNotRefunded: true })).rejects.toThrow(/Only a FAILED/)
  })
})
