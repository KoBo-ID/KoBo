import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { MockPaymentProvider } from '../../src/payment/mock.ts'
import type { PaymentProvider, RefundSnapshot } from '../../src/payment/provider.ts'
import { drainPaymentRefunds, providerRefundReason } from '../../src/payment/refunds.ts'
import { PaymentService } from '../../src/payment/service.ts'
import { XenditError } from '../../src/payment/xendit.ts'
import { approveApplication, newStudent, postXenditWebhook, prisma, TEST_BUSINESS_ID, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const snap = (state: RefundSnapshot['state'] = 'PENDING', id = 'rfd-1'): RefundSnapshot => ({ providerRefundId: id, state, updatedAt: new Date() })
const xErr = (code: string, retryable: boolean, unknown = false) => new XenditError('CREATE_REFUND', retryable ? 503 : 400, code, retryable, unknown, 'raw body secret')

function fakeService(createRefund = vi.fn().mockResolvedValue(snap())) {
  const provider: PaymentProvider = { kind: 'XENDIT', createCheckout: vi.fn(), getSession: vi.fn(), createRefund }
  return { createRefund, service: new PaymentService({ defaultProvider: provider }) }
}

/** An attempt whose money arrived too late: REFUND_PENDING with its queued refund row. */
async function queued(over: { provider?: 'XENDIT' | 'MOCK'; paymentRequestId?: string | null; reason?: string } = {}) {
  const student = await newStudent()
  const room = await vacantRoom()
  const { invoiceId, invoice } = await approveApplication(student.id, room.id)
  const provider = over.provider ?? 'XENDIT'
  const payment = await prisma.payment.create({
    data: {
      invoiceId,
      provider,
      status: 'REFUND_PENDING',
      amount: invoice.amount,
      providerSessionId: `ps_${invoiceId}`,
      providerBusinessId: provider === 'MOCK' ? 'kobo-mock' : TEST_BUSINESS_ID,
      providerPaymentRequestId: over.paymentRequestId === undefined ? `pr_${invoiceId}` : over.paymentRequestId,
      providerPaymentId: `py_${invoiceId}`,
      paidAt: new Date(),
    },
  })
  const refund = await prisma.paymentRefund.create({
    data: { paymentId: payment.id, referenceId: `refund_${payment.id}`, amount: payment.amount, reason: over.reason ?? 'HOLD_EXPIRED' },
  })
  return { payment, refund }
}

const reload = async (paymentId: string) => ({
  payment: await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
  refund: await prisma.paymentRefund.findUniqueOrThrow({ where: { paymentId } }),
})

const refundEvent = (type: 'succeeded' | 'failed', p: { id: string; amount: number; providerPaymentRequestId: string | null }, over: Record<string, unknown> = {}, business = TEST_BUSINESS_ID) => ({
  event: `refund.${type}`,
  business_id: business,
  created: '2026-10-14T05:00:00.000Z',
  data: {
    id: 'rfd-1',
    reference_id: `refund_${p.id}`,
    payment_request_id: p.providerPaymentRequestId,
    amount: p.amount,
    currency: 'IDR',
    status: type === 'succeeded' ? 'SUCCEEDED' : 'FAILED',
    failure_code: type === 'failed' ? 'INSUFFICIENT_BALANCE' : null,
    updated: '2026-10-14T05:00:00.000Z',
    ...over,
  },
})

describe('drainPaymentRefunds', () => {
  it('submits a queued refund with the stable reference, mapped reason and request id', async () => {
    const { payment, refund } = await queued({ reason: 'INVOICE_ALREADY_PAID' })
    const { service, createRefund } = fakeService()
    expect(await drainPaymentRefunds(prisma, service)).toMatchObject({ claimed: 1, submitted: 1 })
    expect(createRefund).toHaveBeenCalledOnce()
    expect(createRefund.mock.calls[0][0]).toMatchObject({
      referenceId: `refund_${payment.id}`,
      providerPaymentRequestId: payment.providerPaymentRequestId,
      amount: payment.amount,
      currency: 'IDR',
      reason: 'DUPLICATE',
      providerBusinessId: TEST_BUSINESS_ID,
    })
    expect(await prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ status: 'SUBMITTED', providerRefundId: 'rfd-1', attempts: 1 })
    expect((await reload(payment.id)).payment.status).toBe('REFUND_PENDING')
  })

  it('maps every internal reason to a provider reason', () => {
    expect(['INVOICE_ALREADY_PAID', 'HOLD_EXPIRED', 'TENANCY_ENDED', 'X'].map(providerRefundReason)).toEqual(['DUPLICATE', 'CANCELLATION', 'CANCELLATION', 'OTHERS'])
  })

  it('completes a MOCK refund locally without a webhook', async () => {
    const { payment } = await queued({ provider: 'MOCK' })
    const service = new PaymentService({ defaultProvider: new MockPaymentProvider() })
    expect(await drainPaymentRefunds(prisma, service)).toMatchObject({ succeeded: 1 })
    const r = await reload(payment.id)
    expect(r.payment).toMatchObject({ status: 'REFUNDED' })
    expect(r.payment.refundedAt).not.toBeNull()
    expect(r.refund.status).toBe('SUCCEEDED')
  })

  it('makes one provider call when drains run concurrently, and does not reclaim a leased row', async () => {
    await queued()
    const { service, createRefund } = fakeService(vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100))
      return snap()
    }))
    await Promise.all([drainPaymentRefunds(prisma, service), drainPaymentRefunds(prisma, service)])
    expect(createRefund).toHaveBeenCalledOnce()
    expect((await drainPaymentRefunds(prisma, service)).claimed).toBe(0)
  })

  it('backs off on a retryable error and does not retry before the delay', async () => {
    const { payment, refund } = await queued()
    const { service, createRefund } = fakeService(vi.fn().mockRejectedValue(xErr('TEMPORARILY_UNAVAILABLE', true)))
    expect(await drainPaymentRefunds(prisma, service)).toMatchObject({ retried: 1 })
    const row = await prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } })
    expect(row).toMatchObject({ status: 'PENDING', lastError: 'TEMPORARILY_UNAVAILABLE', attempts: 1 })
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000)
    expect((await drainPaymentRefunds(prisma, service)).claimed).toBe(0)
    expect(createRefund).toHaveBeenCalledOnce()
    expect((await reload(payment.id)).payment.status).toBe('REFUND_PENDING')
  })

  it('retries after the backoff with the same reference, then fails operator-visibly at the attempt limit', async () => {
    const { payment, refund } = await queued()
    const { service, createRefund } = fakeService(vi.fn().mockRejectedValue(xErr('TEMPORARILY_UNAVAILABLE', true)))
    await drainPaymentRefunds(prisma, service, { maxAttempts: 2 })
    await prisma.paymentRefund.update({ where: { id: refund.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })
    expect(await drainPaymentRefunds(prisma, service, { maxAttempts: 2 })).toMatchObject({ failed: 1 })
    expect(createRefund.mock.calls.map((c) => c[0].referenceId)).toEqual([`refund_${payment.id}`, `refund_${payment.id}`])
    const r = await reload(payment.id)
    expect(r.payment.status).toBe('REFUND_FAILED')
    expect(r.refund).toMatchObject({ status: 'FAILED' })
    expect(r.refund.lastError).toContain('GAVE_UP')
  })

  it('fails immediately on a non-retryable error without leaking provider text', async () => {
    const { payment } = await queued()
    const { service } = fakeService(vi.fn().mockRejectedValue(xErr('INVALID_REQUEST', false)))
    expect(await drainPaymentRefunds(prisma, service)).toMatchObject({ failed: 1 })
    const r = await reload(payment.id)
    expect(r.payment).toMatchObject({ status: 'REFUND_FAILED', failureCode: 'INVALID_REQUEST' })
    expect(r.refund.lastError).toBe('INVALID_REQUEST')
    expect(JSON.stringify(r)).not.toContain('secret')
  })

  it('fails a refund with no provider payment request id without calling the provider', async () => {
    const { payment } = await queued({ paymentRequestId: null })
    const { service, createRefund } = fakeService()
    expect(await drainPaymentRefunds(prisma, service)).toMatchObject({ failed: 1 })
    expect(createRefund).not.toHaveBeenCalled()
    expect((await reload(payment.id)).payment).toMatchObject({ status: 'REFUND_FAILED', failureCode: 'MISSING_PAYMENT_REQUEST_ID' })
  })

  it('treats a provider "refund already in progress" answer as submitted, leaving the outcome to the webhook', async () => {
    const { payment } = await queued()
    const { service } = fakeService(vi.fn().mockRejectedValue(xErr('DUPLICATE_ERROR', false)))
    expect(await drainPaymentRefunds(prisma, service)).toMatchObject({ submitted: 1 })
    expect((await reload(payment.id)).refund).toMatchObject({ status: 'SUBMITTED', providerRefundId: null })
    expect((await postXenditWebhook(refundEvent('succeeded', payment))).status).toBe(200)
    expect(await reload(payment.id)).toMatchObject({ payment: { status: 'REFUNDED' }, refund: { status: 'SUCCEEDED', providerRefundId: 'rfd-1' } })
  })
})

describe('refund webhooks', () => {
  it('marks the refund and payment succeeded, and a duplicate delivery changes nothing', async () => {
    const { payment } = await queued()
    await drainPaymentRefunds(prisma, fakeService().service)
    const body = refundEvent('succeeded', payment)
    expect((await postXenditWebhook(body)).status).toBe(200)
    expect((await postXenditWebhook(refundEvent('succeeded', payment, { updated: '2026-10-14T06:00:00.000Z' }))).status).toBe(200)
    const r = await reload(payment.id)
    expect(r.payment.status).toBe('REFUNDED')
    expect(r.refund).toMatchObject({ status: 'SUCCEEDED', providerRefundId: 'rfd-1' })
    expect((await prisma.paymentWebhookEvent.findMany({ orderBy: { createdAt: 'asc' } })).map((e) => e.reason)).toEqual(['REFUNDED', 'DUPLICATE'])
  })

  it('stores the failure code on a failed refund and keeps it operator-visible', async () => {
    const { payment } = await queued()
    await drainPaymentRefunds(prisma, fakeService().service)
    await postXenditWebhook(refundEvent('failed', payment))
    const r = await reload(payment.id)
    expect(r.payment).toMatchObject({ status: 'REFUND_FAILED', failureCode: 'INSUFFICIENT_BALANCE' })
    expect(r.refund).toMatchObject({ status: 'FAILED', lastError: 'INSUFFICIENT_BALANCE' })
  })

  it('is not undone by a worker that persists SUBMITTED after the webhook already won', async () => {
    const { payment } = await queued()
    await postXenditWebhook(refundEvent('succeeded', payment)) // matched by reference_id before any submission
    expect((await reload(payment.id)).payment.status).toBe('REFUNDED')
    // The worker's late answer for the same refund must not regress the state.
    const { service } = fakeService()
    await prisma.paymentRefund.update({ where: { paymentId: payment.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })
    await drainPaymentRefunds(prisma, service)
    expect(await reload(payment.id)).toMatchObject({ payment: { status: 'REFUNDED' }, refund: { status: 'SUCCEEDED' } })
  })

  it('rejects a mismatched amount, business or payment request id, and reports an unknown reference', async () => {
    const { payment } = await queued()
    await drainPaymentRefunds(prisma, fakeService().service)
    await postXenditWebhook(refundEvent('succeeded', payment, { amount: payment.amount + 1 }))
    await postXenditWebhook(refundEvent('succeeded', payment, { updated: '2026-10-14T05:01:00.000Z' }, 'other_biz'))
    await postXenditWebhook(refundEvent('succeeded', payment, { payment_request_id: 'pr_other', updated: '2026-10-14T05:02:00.000Z' }))
    await postXenditWebhook(refundEvent('succeeded', { ...payment, id: 'ghost' }, { id: 'rfd-ghost' }))
    expect((await prisma.paymentWebhookEvent.findMany({ orderBy: { createdAt: 'asc' } })).map((e) => e.result)).toEqual(['REJECTED', 'REJECTED', 'REJECTED', 'IGNORED'])
    expect(await reload(payment.id)).toMatchObject({ payment: { status: 'REFUND_PENDING' }, refund: { status: 'SUBMITTED' } })
  })

  it('refuses a failure that arrives after the refund already succeeded', async () => {
    const { payment } = await queued()
    await postXenditWebhook(refundEvent('succeeded', payment))
    await postXenditWebhook(refundEvent('failed', payment, { updated: '2026-10-14T07:00:00.000Z' }))
    expect(await reload(payment.id)).toMatchObject({ payment: { status: 'REFUNDED' }, refund: { status: 'SUCCEEDED' } })
  })
})
