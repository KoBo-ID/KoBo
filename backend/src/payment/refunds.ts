import type { PrismaClient } from '../db/client.ts'
import type { CreateRefundInput } from './provider.ts'
import type { PaymentService } from './service.ts'
import { applyRefundResult } from './settlement.ts'
import { XenditError } from './xendit.ts'

export const REFUND_MAX_ATTEMPTS = 8
/** A claimed row is invisible to other workers for this long; a crash mid-call simply becomes a retry. */
export const REFUND_LEASE_SECONDS = 120
/** 1, 2, 4 ... 64 minutes, capped at six hours. */
export const refundBackoffSeconds = (attempt: number) => Math.min(21_600, 60 * 2 ** Math.max(0, attempt - 1))

export function providerRefundReason(reason: string): CreateRefundInput['reason'] {
  if (reason === 'INVOICE_ALREADY_PAID') return 'DUPLICATE'
  if (reason === 'HOLD_EXPIRED' || reason === 'TENANCY_ENDED') return 'CANCELLATION'
  return 'OTHERS'
}

export interface RefundDrainResult {
  claimed: number
  submitted: number
  succeeded: number
  retried: number
  failed: number
}

interface ClaimedRefund {
  id: string
  paymentId: string
  referenceId: string
  amount: number
  reason: string
  attempts: number
}

/** The provider says "already refunded / in progress": the outcome arrives by webhook, retrying would only loop. */
const IN_FLIGHT_CODES = new Set(['DUPLICATE_ERROR', 'REFUND_IN_PROGRESS'])

/**
 * Claims due refunds (EmailOutbox lease pattern), calls the provider outside any lock, and records the answer.
 * Safe to run from several processes: SKIP LOCKED plus the lease means each row is worked by one at a time, and the
 * stable referenceId (also sent as the idempotency key) means a repeated submission cannot refund twice.
 */
export async function drainPaymentRefunds(
  prisma: PrismaClient,
  service: Pick<PaymentService, 'defaultProvider' | 'mockProvider' | 'xenditWebhook'>,
  opts: { batchSize?: number; maxAttempts?: number; now?: () => Date } = {},
): Promise<RefundDrainResult> {
  const batchSize = opts.batchSize ?? 10
  const maxAttempts = opts.maxAttempts ?? REFUND_MAX_ATTEMPTS
  const now = opts.now ?? (() => new Date())
  const rows = await prisma.$queryRaw<ClaimedRefund[]>`
    UPDATE "PaymentRefund"
    SET attempts = attempts + 1,
        "nextAttemptAt" = now() + (${REFUND_LEASE_SECONDS}::int * interval '1 second')
    WHERE id IN (
      SELECT id FROM "PaymentRefund"
      WHERE status = 'PENDING'::"PaymentRefundStatus" AND "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt", id
      LIMIT ${batchSize}::int
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "paymentId", "referenceId", amount, reason, attempts`

  const result: RefundDrainResult = { claimed: rows.length, submitted: 0, succeeded: 0, retried: 0, failed: 0 }
  const settle = (outcome: string) => {
    if (outcome === 'SUBMITTED') result.submitted++
    else if (outcome === 'REFUNDED') result.succeeded++
    else if (outcome === 'REFUND_FAILED') result.failed++
  }
  const fail = async (row: ClaimedRefund, code: string) => {
    settle((await prisma.$transaction((tx) => applyRefundResult(tx, row.id, { state: 'FAILED', providerRefundId: null, failureCode: code, at: now() }))).outcome)
    console.error(`[refunds] ${row.id} failed: ${code}`)
  }

  for (const row of rows) {
    const payment = await prisma.payment.findUnique({
      where: { id: row.paymentId },
      select: { status: true, provider: true, providerPaymentRequestId: true, providerBusinessId: true },
    })
    if (!payment || payment.status !== 'REFUND_PENDING') {
      console.error(`[refunds] ${row.id} skipped: payment not awaiting refund`)
      continue
    }
    if (!payment.providerPaymentRequestId) {
      await fail(row, 'MISSING_PAYMENT_REQUEST_ID')
      continue
    }
    const provider = payment.provider === 'MOCK' ? service.mockProvider : service.defaultProvider.kind === payment.provider ? service.defaultProvider : null

    try {
      if (!provider) throw new Error('PROVIDER_NOT_CONFIGURED')
      const snapshot = await provider.createRefund({
        referenceId: row.referenceId,
        providerPaymentRequestId: payment.providerPaymentRequestId,
        // for-user-id is for sub-accounts only; the master business must not send itself.
        providerBusinessId: payment.providerBusinessId && payment.providerBusinessId !== service.xenditWebhook?.businessId ? payment.providerBusinessId : undefined,
        amount: row.amount,
        currency: 'IDR',
        reason: providerRefundReason(row.reason),
      })
      const applied = await prisma.$transaction((tx) =>
        applyRefundResult(tx, row.id, { state: snapshot.state, providerRefundId: snapshot.providerRefundId, failureCode: snapshot.state === 'FAILED' ? 'REFUND_FAILED' : null, at: now() }),
      )
      settle(applied.outcome)
    } catch (e) {
      const code = e instanceof XenditError ? e.code : e instanceof Error ? e.message.slice(0, 64) : 'UNKNOWN'
      if (e instanceof XenditError && IN_FLIGHT_CODES.has(e.code)) {
        settle((await prisma.$transaction((tx) => applyRefundResult(tx, row.id, { state: 'PENDING', providerRefundId: null, at: now() }))).outcome)
        continue
      }
      const retryable = !(e instanceof XenditError) || e.retryable || e.outcomeUnknown
      if (!retryable || row.attempts >= maxAttempts) {
        await fail(row, retryable ? `GAVE_UP_${code}`.slice(0, 64) : code)
        continue
      }
      result.retried++
      console.error(`[refunds] ${row.id} attempt ${row.attempts}/${maxAttempts} ${code}`)
      await prisma.paymentRefund.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { nextAttemptAt: new Date(now().getTime() + refundBackoffSeconds(row.attempts) * 1000), lastError: code },
      })
    }
  }
  return result
}

/** Not started from createApp: tests call drainPaymentRefunds() directly. Returns a stop function. */
export function startRefundWorker(prisma: PrismaClient, service: Pick<PaymentService, 'defaultProvider' | 'mockProvider' | 'xenditWebhook'>, intervalMs = 15_000): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await drainPaymentRefunds(prisma, service)
    } catch (err) {
      console.error('[refunds] drain failed:', err instanceof Error ? err.message : err)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  return () => clearInterval(timer)
}
