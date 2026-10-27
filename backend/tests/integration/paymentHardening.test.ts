import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDemo } from '../../src/demoReset.ts'
import { resetDb } from '../../src/db/seed.ts'
import { paymentEnv } from '../../src/env.ts'
import type { PaymentProvider, PaymentSessionSnapshot } from '../../src/payment/provider.ts'
import { sweepStalePayments } from '../../src/payment/reconcile.ts'
import { drainPaymentRefunds, requeueRefund } from '../../src/payment/refunds.ts'
import { PaymentService } from '../../src/payment/service.ts'
import { applyPaymentEventTx } from '../../src/payment/settlement.ts'
import { XenditError } from '../../src/payment/xendit.ts'
import { app, approveApplication, callerFor, DEMO_STUDENT_ID, newStudent, postXenditWebhook, prisma, sessionWebhook, TEST_BUSINESS_ID, TEST_CALLBACK_TOKEN, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const opts = { provider: 'XENDIT' as const, expectedBusinessId: TEST_BUSINESS_ID }

async function fixture(userId?: string, over: Record<string, unknown> = {}) {
  const uid = userId ?? (await newStudent()).id
  const room = await vacantRoom()
  const approved = await approveApplication(uid, room.id)
  const payment = await prisma.payment.create({
    data: {
      invoiceId: approved.invoiceId,
      provider: 'XENDIT',
      status: 'PENDING',
      amount: approved.invoice.amount,
      providerSessionId: `ps_${approved.invoiceId}`,
      providerBusinessId: TEST_BUSINESS_ID,
      providerPaymentRequestId: `pr_${approved.invoiceId}`,
      checkoutUrl: 'https://checkout.xendit.co/web/x',
      expiresAt: new Date(Date.now() + 20 * 60_000),
      ...over,
    },
  })
  return { uid, ...approved, payment }
}

const completedEvent = (p: { id: string; amount: number; providerSessionId: string | null }, occurredAt: Date) => ({
  kind: 'SESSION_COMPLETED' as const,
  referenceId: p.id,
  providerBusinessId: TEST_BUSINESS_ID,
  amount: p.amount,
  currency: 'IDR' as const,
  occurredAt,
  providerSessionId: p.providerSessionId!,
  providerPaymentRequestId: `pr_${p.id}`,
  providerPaymentId: `py_${p.id}`,
})

const refundRow = (paymentId: string, amount: number) =>
  prisma.paymentRefund.create({ data: { paymentId, referenceId: `refund_${paymentId}`, amount, reason: 'HOLD_EXPIRED' } })

describe('refund rows and cascading deletes', () => {
  it('demo reset completes when the demo student has a refund row, and removes it with its payment', async () => {
    const { payment, tenancyId } = await fixture(DEMO_STUDENT_ID)
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUND_PENDING' } })
    await refundRow(payment.id, payment.amount)
    await resetDemo(prisma, new Date())
    expect(await prisma.tenancy.findUnique({ where: { id: tenancyId } })).toBeNull()
    expect(await prisma.paymentRefund.count()).toBe(0)
  })

  it('archives (never deletes) a kos or room that holds refund history, and keeps every financial row', async () => {
    const { room, payment, tenancyId } = await fixture()
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } })
    await refundRow(payment.id, payment.amount)
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { status: 'ENDED' } })
    // The seed's first vacant room can share a kos with seeded live tenancies, which rightly block kos.delete: end them so only archiving is under test.
    await prisma.tenancy.updateMany({ where: { room: { kosId: room.kosId }, status: { in: ['ACTIVE', 'PENDING'] } }, data: { status: 'ENDED' } })
    await prisma.rentalApplication.updateMany({ where: { room: { kosId: room.kosId }, status: 'PENDING' }, data: { status: 'REJECTED' } })
    const ownerProfile = await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: room.kosId } } } })
    await prisma.user.update({ where: { id: ownerProfile.userId }, data: { isDemo: false } })
    const owner = callerFor(ownerProfile.userId)
    expect(await owner.owner.room.delete({ kosId: room.kosId, roomId: room.id })).toEqual({ id: room.id, archived: true })
    expect(await owner.owner.kos.delete({ kosId: room.kosId })).toEqual({ id: room.kosId, archived: true })
    expect(await prisma.paymentRefund.count({ where: { paymentId: payment.id } })).toBe(1)
    expect(await prisma.payment.count({ where: { id: payment.id } })).toBe(1)
  })

  it('simulate refuses a lapsed demo attempt instead of queuing a refund', async () => {
    const { payment, uid } = await fixture(DEMO_STUDENT_ID, { provider: 'MOCK', checkoutUrl: null, expiresAt: new Date(Date.now() - 1000) })
    expect(uid).toBe(DEMO_STUDENT_ID)
    expect((await err(callerFor(DEMO_STUDENT_ID, { isDemo: true }).payment.simulate({ paymentId: payment.id })))?.code).toBe('NOT_FOUND')
    expect(await prisma.paymentRefund.count()).toBe(0)
  })
})

describe('webhook route hardening', () => {
  it('rejects an oversized body with 413 before authentication and without touching the database', async () => {
    const big = JSON.stringify({ event: 'x', data: { pad: 'a'.repeat(70 * 1024) } })
    const res = await app.request('/api/webhooks/xendit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-callback-token': 'nope' }, body: big })
    expect(res.status).toBe(413)
    expect(await prisma.paymentWebhookEvent.count()).toBe(0)
  })

  it('settles a completed event that only carries latest_payment_request_id', async () => {
    const { payment, tenancyId } = await fixture()
    const body = sessionWebhook('completed', payment)
    delete (body.data as Record<string, unknown>).payment_request_id
    ;(body.data as Record<string, unknown>).latest_payment_request_id = 'pr_latest'
    expect((await postXenditWebhook(body)).status).toBe(200)
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ACTIVE')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).providerPaymentRequestId).toBe('pr_latest')
  })

  it('audits (200) a completed event it cannot verify, instead of a 400 that Xendit would drop after retries', async () => {
    const { payment } = await fixture()
    const noAmount = sessionWebhook('completed', payment)
    delete (noAmount.data as Record<string, unknown>).amount
    delete (noAmount.data as Record<string, unknown>).currency
    expect((await postXenditWebhook(noAmount)).status).toBe(200)
    const noIds = sessionWebhook('completed', payment, { updated: '2026-10-14T04:00:00.000Z' })
    delete (noIds.data as Record<string, unknown>).payment_id
    expect((await postXenditWebhook(noIds)).status).toBe(200)
    expect((await prisma.paymentWebhookEvent.findMany({ orderBy: { createdAt: 'asc' } })).map((e) => e.reason)).toEqual(['MISSING_AMOUNT', 'MISSING_PAYMENT_IDS'])
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING')
  })
})

describe('a payment completed before the hold ended', () => {
  it('is honoured when the callback is processed just after the hold, unless the room was offered to someone else', async () => {
    const a = await fixture()
    await prisma.tenancy.update({ where: { id: a.tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const result = await applyPaymentEventTx(prisma, opts, completedEvent(a.payment, new Date(Date.now() - 5000)))
    expect(result.outcome).toBe('SETTLED')
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: a.tenancyId } })).status).toBe('ACTIVE')
  })

  it('is refunded when it completed after the hold ended', async () => {
    const a = await fixture()
    await prisma.tenancy.update({ where: { id: a.tenancyId }, data: { expiresAt: new Date(Date.now() - 60_000) } })
    expect((await applyPaymentEventTx(prisma, opts, completedEvent(a.payment, new Date()))).outcome).toBe('REFUND_QUEUED')
  })

  it('is refunded when a live waitlist offer reserved the room in the meantime', async () => {
    const a = await fixture()
    await prisma.tenancy.update({ where: { id: a.tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const waiter = await newStudent()
    await prisma.waitlistEntry.create({
      data: { userId: waiter.id, kosId: a.room.kosId, status: 'OFFERED', offeredRoomId: a.room.id, offerExpiresAt: new Date(Date.now() + 3600_000) },
    })
    expect((await applyPaymentEventTx(prisma, opts, completedEvent(a.payment, new Date(Date.now() - 5000)))).outcome).toBe('REFUND_QUEUED')
  })
})

describe('refund edge cases', () => {
  const svc = (createRefund: PaymentProvider['createRefund']) => new PaymentService({ defaultProvider: { kind: 'XENDIT', createCheckout: vi.fn(), getSession: vi.fn(), createRefund } })

  it('treats REFUND_AMOUNT_EXCEEDED on resubmission as already refunding, not a failed refund', async () => {
    const { payment } = await fixture(undefined, { status: 'REFUND_PENDING', providerPaymentId: 'py_x' })
    await refundRow(payment.id, payment.amount)
    const createRefund = vi.fn().mockRejectedValue(new XenditError('CREATE_REFUND', 400, 'REFUND_AMOUNT_EXCEEDED', false, false, 'x'))
    expect(await drainPaymentRefunds(prisma, svc(createRefund))).toMatchObject({ submitted: 1, failed: 0 })
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUND_PENDING')
  })

  it('still matches a late callback for the ORIGINAL reference after an operator re-queue', async () => {
    const { payment } = await fixture(undefined, { status: 'REFUND_FAILED', providerPaymentId: 'py_x' })
    const refund = await prisma.paymentRefund.create({
      data: { paymentId: payment.id, referenceId: `refund_${payment.id}`, amount: payment.amount, reason: 'HOLD_EXPIRED', status: 'FAILED', lastError: 'INSUFFICIENT_BALANCE' },
    })
    await requeueRefund(prisma, refund.id, { confirmNotRefunded: true })
    const callback = {
      event: 'refund.succeeded',
      business_id: TEST_BUSINESS_ID,
      created: '2026-10-14T05:00:00.000Z',
      data: { id: 'rfd-original', reference_id: `refund_${payment.id}`, payment_request_id: payment.providerPaymentRequestId, amount: payment.amount, currency: 'IDR', status: 'SUCCEEDED', failure_code: null, updated: '2026-10-14T05:00:00.000Z' },
    }
    expect((await postXenditWebhook(callback)).status).toBe(200)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUNDED')
  })
})

describe('sweepStalePayments', () => {
  const snap = (p: { id: string; amount: number; providerSessionId: string | null }, over: Partial<PaymentSessionSnapshot> = {}): PaymentSessionSnapshot => ({
    state: 'COMPLETED',
    referenceId: p.id,
    providerSessionId: p.providerSessionId!,
    providerPaymentRequestId: `pr_${p.id}`,
    providerPaymentId: `py_${p.id}`,
    providerBusinessId: TEST_BUSINESS_ID,
    amount: p.amount,
    currency: 'IDR',
    updatedAt: new Date(),
    ...over,
  })
  const service = (getSession: PaymentProvider['getSession']) =>
    new PaymentService({ defaultProvider: { kind: 'XENDIT', createCheckout: vi.fn(), getSession, createRefund: vi.fn() }, xenditWebhook: { callbackToken: TEST_CALLBACK_TOKEN, businessId: TEST_BUSINESS_ID } })

  it('credits a payment whose callbacks never arrived, with no tenant action', async () => {
    const { payment, tenancyId } = await fixture()
    await prisma.payment.update({ where: { id: payment.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } })
    const getSession = vi.fn().mockResolvedValue(snap(payment))
    expect(await sweepStalePayments(prisma, service(getSession))).toEqual({ checked: 1 })
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ACTIVE')
    // Settled attempts are no longer swept.
    expect(await sweepStalePayments(prisma, service(getSession))).toEqual({ checked: 0 })
  })

  it('rechecks a recently expired attempt once, not on every pass, and skips fresh or old ones', async () => {
    const { payment } = await fixture()
    const old = Date.now() - 20 * 60_000
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED', createdAt: new Date(old), expiresAt: new Date(Date.now() - 5 * 60_000) } })
    const getSession = vi.fn().mockResolvedValue(snap(payment, { state: 'EXPIRED', providerPaymentId: null }))
    expect(await sweepStalePayments(prisma, service(getSession))).toEqual({ checked: 1 })
    expect(await sweepStalePayments(prisma, service(getSession))).toEqual({ checked: 0 })
    await prisma.payment.update({ where: { id: payment.id }, data: { lastReconciledAt: null, expiresAt: new Date(Date.now() - 3 * 24 * 3600_000) } })
    expect(await sweepStalePayments(prisma, service(getSession))).toEqual({ checked: 0 })
  })

  it('survives a provider error and leaves the attempt unchanged', async () => {
    const { payment } = await fixture()
    await prisma.payment.update({ where: { id: payment.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } })
    const getSession = vi.fn().mockRejectedValue(new XenditError('GET_SESSION', 503, 'TEMPORARILY_UNAVAILABLE', true, false, 'x'))
    expect(await sweepStalePayments(prisma, service(getSession))).toEqual({ checked: 1 })
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING')
  })
})

describe('config', () => {
  it('rejects a non-https PAYMENT_RETURN_ORIGIN when using Xendit', () => {
    const env = { PAYMENT_PROVIDER: 'xendit', XENDIT_SECRET_API_KEY: 'xnd_development_k', XENDIT_CALLBACK_TOKEN: 't', XENDIT_BUSINESS_ID: 'b', NODE_ENV: 'test' }
    expect(() => paymentEnv({ ...env, PAYMENT_RETURN_ORIGIN: 'http://kobo.test' })).toThrow(/https/)
    expect(() => paymentEnv({ ...env, PAYMENT_RETURN_ORIGIN: 'https://kobo.test' })).not.toThrow()
  })
})
