import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '../db/client.ts'
import type { NormalizedPaymentEvent, PaymentSessionSnapshot } from './provider.ts'
import type { PaymentService } from './service.ts'
import { applyPaymentEventTx } from './settlement.ts'
import { XenditError } from './xendit.ts'

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

/**
 * Asks the provider (server to server) what happened to one attempt and feeds the answer through the same settlement
 * as a webhook. Returns once the state is current; it never trusts the browser. No lock is held during the lookup.
 */
export async function reconcilePayment(prisma: PrismaClient, service: Service, userId: string, paymentId: string, now = new Date()): Promise<void> {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, invoice: { tenancy: { userId } } } })
  if (!payment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pembayaran tidak ditemukan.' })

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
    throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Status pembayaran belum dapat diperiksa. Coba lagi nanti.' })
  }

  if (snap.referenceId !== payment.id || snap.providerSessionId !== payment.providerSessionId || (snap.amount !== null && snap.amount !== payment.amount) || (snap.currency !== null && snap.currency !== 'IDR')) {
    console.error('[payments] reconcile mismatch', { paymentId: payment.id })
    return
  }
  const event = eventFromSnapshot(snap, payment, businessId)
  if (event) await applyPaymentEventTx(prisma, { provider: 'XENDIT', expectedBusinessId: master, now }, event)
}
