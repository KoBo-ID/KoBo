import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '../db/client.ts'
import type { NormalizedPaymentEvent, PaymentSessionSnapshot } from './provider.ts'
import type { PaymentService } from './service.ts'
import { applyPaymentEventTx } from './settlement.ts'
import { XenditError } from './xendit.ts'
import { startPeriodic, type StopWorker } from '../worker.ts'

/** One provider lookup per attempt per this window; extra clicks just see the current state. */
export const RECONCILE_MIN_INTERVAL_MS = 30_000

type Service = Pick<PaymentService, 'defaultProvider' | 'xenditWebhook'>

/** Maps a provider session snapshot to the same normalized event a webhook would carry, or null when nothing changed. */
export function eventFromSnapshot(
  snap: PaymentSessionSnapshot,
  payment: { id: string; providerPaymentRequestId: string | null; providerPaymentId: string | null },
  businessId: string,
): NormalizedPaymentEvent | null {
  if (snap.state === 'ACTIVE' || snap.amount === null) return null
  const base = { referenceId: snap.referenceId, providerBusinessId: businessId, amount: snap.amount, currency: 'IDR' as const, occurredAt: snap.updatedAt }
  if (snap.state === 'COMPLETED') {
    const paymentRequestId = snap.providerPaymentRequestId ?? payment.providerPaymentRequestId
    const paymentId = snap.providerPaymentId ?? payment.providerPaymentId
    // Never invent identifiers the refund path will need: wait for the webhook instead.
    if (!paymentRequestId || !paymentId) return null
    return { ...base, kind: 'SESSION_COMPLETED', providerSessionId: snap.providerSessionId, providerPaymentRequestId: paymentRequestId, providerPaymentId: paymentId }
  }
  // EXPIRED and a canceled session are both terminal and retryable by the tenant.
  return { ...base, kind: 'SESSION_EXPIRED', providerSessionId: snap.providerSessionId }
}

type PaymentRow = NonNullable<Awaited<ReturnType<PrismaClient['payment']['findFirst']>>>

/**
 * Asks the provider (server to server) what happened to one attempt and feeds the answer through the same settlement
 * as a webhook. Returns once the state is current; it never trusts the browser. No lock is held during the lookup.
 */
export async function reconcilePayment(prisma: PrismaClient, service: Service, userId: string, paymentId: string, now = new Date()): Promise<void> {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, invoice: { tenancy: { userId } } } })
  if (!payment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pembayaran tidak ditemukan.' })
  await reconcileAttempt(prisma, service, payment, now, true)
}

/** Shared by the tenant action and the background sweep. `strict` surfaces provider errors to the caller. */
async function reconcileAttempt(prisma: PrismaClient, service: Service, payment: PaymentRow, now: Date, strict: boolean): Promise<void> {
  // Settled, refunding, manual or in-app attempts have nothing to ask the provider; MOCK is only ever settled by simulate.
  if (payment.provider !== 'XENDIT' || !['CREATING', 'PENDING', 'EXPIRED', 'FAILED'].includes(payment.status) || !payment.providerSessionId) return
  const provider = service.defaultProvider
  const master = service.xenditWebhook?.businessId
  if (provider.kind !== 'XENDIT' || !master) return

  // Atomic throttle: Postgres re-checks the WHERE under the row lock, so parallel clicks claim at most once.
  const claimed = await prisma.payment.updateMany({
    where: { id: payment.id, OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: new Date(now.getTime() - RECONCILE_MIN_INTERVAL_MS) } }] },
    data: { lastReconciledAt: now },
  })
  if (claimed.count === 0) return

  const businessId = payment.providerBusinessId ?? master
  let snap: PaymentSessionSnapshot
  try {
    // for-user-id is only for sub-accounts; the master business must not send itself.
    snap = await provider.getSession({ providerSessionId: payment.providerSessionId, providerBusinessId: businessId === master ? undefined : businessId })
  } catch (e) {
    console.error('[payments] reconcile lookup failed', { paymentId: payment.id, code: e instanceof XenditError ? e.code : 'UNKNOWN' })
    if (strict) throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Status pembayaran belum dapat diperiksa. Coba lagi nanti.' })
    return
  }

  if (snap.referenceId !== payment.id || snap.providerSessionId !== payment.providerSessionId || (snap.amount !== null && snap.amount !== payment.amount) || (snap.currency !== null && snap.currency !== 'IDR')) {
    console.error('[payments] reconcile mismatch', { paymentId: payment.id })
    return
  }
  const event = eventFromSnapshot(snap, payment, businessId)
  if (event) await applyPaymentEventTx(prisma, { provider: 'XENDIT', expectedBusinessId: master, now }, event)
}

export const SWEEP_LIVE_AFTER_MS = 10 * 60_000
export const SWEEP_CLOSED_RECHECK_MS = 60 * 60_000
export const SWEEP_CLOSED_WINDOW_MS = 24 * 3600_000

/**
 * Safety net for lost callbacks (outage, every retry failed, an unverifiable payload): asks Xendit about attempts that
 * are still open past a grace period, or that closed within the last day, so money that arrived is credited or
 * refunded without anyone clicking. Provider errors are logged and retried on the next pass.
 */
export async function sweepStalePayments(prisma: PrismaClient, service: Service, opts: { limit?: number; now?: Date } = {}): Promise<{ checked: number }> {
  const now = opts.now ?? new Date()
  const rows = await prisma.payment.findMany({
    where: {
      provider: 'XENDIT',
      providerSessionId: { not: null },
      createdAt: { lt: new Date(now.getTime() - SWEEP_LIVE_AFTER_MS) },
      OR: [
        { status: 'PENDING', OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: new Date(now.getTime() - SWEEP_LIVE_AFTER_MS) } }] },
        {
          status: { in: ['EXPIRED', 'FAILED'] },
          expiresAt: { gt: new Date(now.getTime() - SWEEP_CLOSED_WINDOW_MS) },
          OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: new Date(now.getTime() - SWEEP_CLOSED_RECHECK_MS) } }],
        },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 20,
  })
  for (const payment of rows) {
    try {
      await reconcileAttempt(prisma, service, payment, now, false)
    } catch (e) {
      console.error('[payments] sweep failed', { paymentId: payment.id, code: (e as { code?: string }).code ?? 'UNKNOWN' })
    }
  }
  return { checked: rows.length }
}

/** Not started from createApp: tests call sweepStalePayments() directly. Returns a stop function. */
export function startPaymentSweep(prisma: PrismaClient, service: Service, intervalMs = 5 * 60_000): StopWorker {
  return startPeriodic('payments', intervalMs, () => sweepStalePayments(prisma, service))
}
