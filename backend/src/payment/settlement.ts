import type { PrismaClient } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { settleInvoice } from '../payments.ts'
import { liveOffer } from '../waitlist.ts'
import type { NormalizedPaymentEvent } from './provider.ts'

type Tx = Prisma.TransactionClient

export type SettlementOutcome = 'SETTLED' | 'DUPLICATE' | 'REFUND_QUEUED' | 'REFUNDED' | 'REFUND_FAILED' | 'EXPIRED' | 'IGNORED' | 'REJECTED' | 'UNMATCHED'
export interface SettlementResult {
  outcome: SettlementOutcome
  paymentId: string | null
  reason?: string
}
export interface SettlementOptions {
  provider: 'MOCK' | 'XENDIT'
  /** Business ID the provider was configured with; used when the attempt row never stored one (crash recovery). */
  expectedBusinessId: string
  now?: Date
}

/** The attempt states in which an arriving "completed" still means real money that has not been booked yet. */
const UNSETTLED = new Set(['CREATING', 'PENDING', 'EXPIRED', 'FAILED'])
const reject = (paymentId: string, reason: string): SettlementResult => ({ outcome: 'REJECTED', paymentId, reason })

/**
 * Provider-neutral settlement of one normalized event (plan Task 6). Runs inside the caller's transaction so Task 7 can
 * record the webhook fingerprint atomically. Validation failures are returned, never thrown: the caller still audits
 * the event and answers 200 so the provider does not retry forever. Only transient database errors throw.
 *
 * Lock order is Invoice, Payment, Tenancy. That is the order payment.start and recordManual already use, so a webhook
 * racing either of them cannot deadlock. An attempt's invoiceId never changes, so reading it unlocked is safe.
 */
export async function applyPaymentEvent(tx: Tx, opts: SettlementOptions, event: NormalizedPaymentEvent): Promise<SettlementResult> {
  const now = opts.now ?? new Date()
  if (event.kind === 'REFUND_SUCCEEDED' || event.kind === 'REFUND_FAILED') return applyRefundEvent(tx, opts, event)

  const ref = await tx.payment.findUnique({ where: { id: event.referenceId }, select: { invoiceId: true } })
  if (!ref) return { outcome: 'UNMATCHED', paymentId: null }
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${ref.invoiceId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${event.referenceId} FOR UPDATE`
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: event.referenceId } })

  if (payment.provider !== opts.provider) return reject(payment.id, 'PROVIDER_MISMATCH')
  if (event.providerBusinessId !== (payment.providerBusinessId ?? opts.expectedBusinessId)) return reject(payment.id, 'BUSINESS_MISMATCH')

  if (event.kind === 'SESSION_EXPIRED') {
    if (payment.providerSessionId && payment.providerSessionId !== event.providerSessionId) return reject(payment.id, 'SESSION_MISMATCH')
    const done = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ['CREATING', 'PENDING'] } }, data: { status: 'EXPIRED' } })
    return { outcome: done.count ? 'EXPIRED' : 'IGNORED', paymentId: payment.id }
  }

  // SESSION_COMPLETED
  if (payment.providerSessionId && payment.providerSessionId !== event.providerSessionId) return reject(payment.id, 'SESSION_MISMATCH')
  if (event.currency !== 'IDR') return reject(payment.id, 'CURRENCY_MISMATCH')
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId }, include: { tenancy: { select: { id: true } } } })
  if (event.amount !== payment.amount || event.amount !== invoice.amount) return reject(payment.id, 'AMOUNT_MISMATCH')

  // Already booked or already on the refund path: a repeated delivery changes nothing.
  if (!UNSETTLED.has(payment.status)) return { outcome: 'DUPLICATE', paymentId: payment.id }

  await tx.$queryRaw`SELECT id FROM "Tenancy" WHERE id = ${invoice.tenancy.id} FOR UPDATE`
  const tenancy = await tx.tenancy.findUniqueOrThrow({ where: { id: invoice.tenancy.id }, include: { invoices: { select: { id: true }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: 1 } } })

  const isFirstInvoice = tenancy.invoices[0]?.id === invoice.id
  let refundReason: string | null = null
  if (invoice.status === 'PAID') refundReason = 'INVOICE_ALREADY_PAID'
  else if (tenancy.status === 'ENDED') refundReason = 'TENANCY_ENDED'
  else if (tenancy.status === 'PENDING') {
    // The session ends with the hold, so a callback delayed by a retry can land just after it. The payment is honoured
    // when it COMPLETED before the hold ended and nobody else has the room (a lapsed hold is ended by the next booking
    // for the room, and a live waitlist offer reserves it).
    let holdLive = !!tenancy.expiresAt && tenancy.expiresAt > now
    if (!holdLive && tenancy.expiresAt && event.occurredAt <= tenancy.expiresAt) {
      holdLive = (await tx.waitlistEntry.count({ where: { offeredRoomId: tenancy.roomId, ...liveOffer(now) } })) === 0
    }
    if (!(isFirstInvoice && holdLive)) refundReason = 'HOLD_EXPIRED'
  }

  // Money arrived whatever happens next: keep the provider identifiers the refund worker needs.
  const received = {
    providerSessionId: payment.providerSessionId ?? event.providerSessionId,
    providerPaymentRequestId: event.providerPaymentRequestId,
    providerPaymentId: event.providerPaymentId,
    providerBusinessId: payment.providerBusinessId ?? event.providerBusinessId,
    paidAt: event.occurredAt,
  }

  if (refundReason) {
    await tx.payment.update({ where: { id: payment.id }, data: { ...received, status: 'REFUND_PENDING' } })
    await tx.paymentRefund.create({ data: { paymentId: payment.id, referenceId: `refund_${payment.id}`, amount: payment.amount, reason: refundReason } })
    return { outcome: 'REFUND_QUEUED', paymentId: payment.id, reason: refundReason }
  }

  await tx.payment.update({ where: { id: payment.id }, data: { ...received, status: 'PAID' } })
  await settleInvoice(tx, invoice.id, payment.id)
  return { outcome: 'SETTLED', paymentId: payment.id }
}

/** Standalone transaction wrapper for callers that have no transaction of their own. */
export const applyPaymentEventTx = (prisma: PrismaClient, opts: SettlementOptions, event: NormalizedPaymentEvent) =>
  prisma.$transaction((tx) => applyPaymentEvent(tx, opts, event))

export interface RefundResultInput {
  state: 'PENDING' | 'SUCCEEDED' | 'FAILED'
  providerRefundId: string | null
  failureCode?: string | null
  at: Date
}
export interface RefundApplyResult {
  outcome: 'SUBMITTED' | 'REFUNDED' | 'REFUND_FAILED' | 'DUPLICATE' | 'REJECTED'
  reason?: string
}

/**
 * Records what the provider said about one refund, from either the worker (synchronous answer) or a webhook. Every
 * transition is conditional on the stored state, so whichever arrives second is a no-op and a late webhook is never
 * undone by the worker. Lock order matches settlement: Invoice, Payment, PaymentRefund. Invoice and Tenancy are
 * never changed: a refund only closes the money loop of an attempt that was not fulfilled.
 */
export async function applyRefundResult(tx: Tx, refundId: string, o: RefundResultInput): Promise<RefundApplyResult> {
  const ref = await tx.paymentRefund.findUnique({ where: { id: refundId }, select: { payment: { select: { id: true, invoiceId: true } } } })
  if (!ref) return { outcome: 'REJECTED', reason: 'REFUND_NOT_FOUND' }
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${ref.payment.invoiceId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${ref.payment.id} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM "PaymentRefund" WHERE id = ${refundId} FOR UPDATE`
  const refund = await tx.paymentRefund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: { select: { status: true } } } })
  if (!['REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED'].includes(refund.payment.status)) return { outcome: 'REJECTED', reason: 'PAYMENT_NOT_REFUNDING' }
  if (refund.providerRefundId && o.providerRefundId && refund.providerRefundId !== o.providerRefundId) return { outcome: 'REJECTED', reason: 'REFUND_ID_MISMATCH' }
  const providerRefundId = refund.providerRefundId ?? o.providerRefundId

  if (o.state === 'PENDING') {
    // Only a refund nobody has answered yet moves to SUBMITTED.
    if (refund.status !== 'PENDING') return { outcome: 'DUPLICATE' }
    await tx.paymentRefund.update({ where: { id: refundId }, data: { status: 'SUBMITTED', providerRefundId, submittedAt: o.at, lastError: null } })
    return { outcome: 'SUBMITTED' }
  }
  if (o.state === 'SUCCEEDED') {
    if (refund.status === 'SUCCEEDED') return { outcome: 'DUPLICATE' }
    // The provider is the source of truth: a success also repairs a refund this side had marked FAILED.
    await tx.paymentRefund.update({ where: { id: refundId }, data: { status: 'SUCCEEDED', providerRefundId, succeededAt: o.at, lastError: null } })
    await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUNDED', refundedAt: o.at, failureCode: null } })
    return { outcome: 'REFUNDED' }
  }
  if (refund.status === 'SUCCEEDED') return { outcome: 'REJECTED', reason: 'REFUND_ALREADY_SUCCEEDED' }
  if (refund.status === 'FAILED') return { outcome: 'DUPLICATE' }
  const failureCode = o.failureCode ?? 'REFUND_FAILED'
  await tx.paymentRefund.update({ where: { id: refundId }, data: { status: 'FAILED', providerRefundId, failedAt: o.at, lastError: failureCode } })
  await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUND_FAILED', failureCode } })
  return { outcome: 'REFUND_FAILED', reason: failureCode }
}

async function applyRefundEvent(
  tx: Tx,
  opts: SettlementOptions,
  event: Extract<NormalizedPaymentEvent, { kind: 'REFUND_SUCCEEDED' | 'REFUND_FAILED' }>,
): Promise<SettlementResult> {
  const found =
    (await tx.paymentRefund.findUnique({ where: { referenceId: event.referenceId }, select: { id: true } })) ??
    (await tx.paymentRefund.findUnique({ where: { providerRefundId: event.providerRefundId }, select: { id: true } })) ??
    // An operator re-queue gives the row a fresh reference; a late callback for the ORIGINAL reference still finds it.
    (await originalReference(tx, event.referenceId))
  if (!found) return { outcome: 'UNMATCHED', paymentId: null }

  const refund = await tx.paymentRefund.findUniqueOrThrow({ where: { id: found.id }, include: { payment: true } })
  const { payment } = refund
  const reject = (reason: string): SettlementResult => ({ outcome: 'REJECTED', paymentId: payment.id, reason })
  if (payment.provider !== opts.provider) return reject('PROVIDER_MISMATCH')
  if (event.providerBusinessId !== (payment.providerBusinessId ?? opts.expectedBusinessId)) return reject('BUSINESS_MISMATCH')
  if (event.currency !== 'IDR') return reject('CURRENCY_MISMATCH')
  if (event.amount !== refund.amount) return reject('AMOUNT_MISMATCH')
  if (payment.providerPaymentRequestId !== event.providerPaymentRequestId) return reject('PAYMENT_REQUEST_MISMATCH')

  const res = await applyRefundResult(tx, refund.id, {
    state: event.kind === 'REFUND_SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
    providerRefundId: event.providerRefundId,
    failureCode: event.kind === 'REFUND_FAILED' ? event.failureCode?.replace(/[^A-Z0-9_]/gi, '').slice(0, 64) || 'REFUND_FAILED' : null,
    at: event.occurredAt,
  })
  if (res.outcome === 'REJECTED') return reject(res.reason ?? 'REJECTED')
  if (res.outcome === 'DUPLICATE') return { outcome: 'DUPLICATE', paymentId: payment.id }
  return { outcome: res.outcome === 'REFUNDED' ? 'REFUNDED' : 'REFUND_FAILED', paymentId: payment.id, reason: res.reason }
}

async function originalReference(tx: Tx, referenceId: string): Promise<{ id: string } | null> {
  const m = /^refund_([A-Za-z0-9]+)$/.exec(referenceId)
  return m ? tx.paymentRefund.findUnique({ where: { paymentId: m[1] }, select: { id: true } }) : null
}
