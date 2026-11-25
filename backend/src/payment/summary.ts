import { formatReceiptNo } from '@kobo/shared/domain'

/** What a tenant may see about one payment attempt. No provider ids, no raw provider fields. */
export interface PaymentSummary {
  id: string
  provider: 'XENDIT' | 'MOCK' | 'MANUAL'
  status: 'CREATING' | 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED'
  /** Only for the payer, a live XENDIT attempt and an https URL; null otherwise. */
  checkoutUrl: string | null
  expiresAt: string | null
  paidAt: string | null
  /** Raw Payment.receiptNo for /kuitansi/:receiptNo; null until paid. */
  receiptNumber: number | null
  receiptNo: string | null
  /** Why the money is going back (PaymentRefund.reason, e.g. HOLD_EXPIRED, INVOICE_ALREADY_PAID, TENANCY_ENDED); null when no refund row. */
  refundReason: string | null
}

/** A CREATING row older than this lost its provider call (crash/timeout); treated as dead on read and failed on retry. */
export const CREATING_STALE_MS = 2 * 60 * 1000

export interface PaymentRow {
  id: string
  provider: PaymentSummary['provider']
  status: PaymentSummary['status']
  checkoutUrl: string | null
  expiresAt: Date | null
  paidAt: Date | null
  receiptNo: number
  /** Optional so synthetic unit-test rows keep compiling; Prisma queries include it so stale CREATING rows expire on read. */
  createdAt?: Date | null
  /** Optional so callers that do not load the refund keep compiling; they then get refundReason null. */
  refund?: { status?: string; reason?: string } | null
}

export const isStaleCreating = (p: { provider: string; status: string; createdAt?: Date | null }, now: Date) =>
  p.provider !== 'MANUAL' && p.status === 'CREATING' && !!p.createdAt && now.getTime() - p.createdAt.getTime() >= CREATING_STALE_MS

/** Whether an attempt is still open for the tenant: CREATING/PENDING, not past its expiry (null expiry = open), and not a stale CREATING row. */
export const isLiveAttempt = (p: { provider: string; status: string; expiresAt: Date | null; createdAt?: Date | null }, now: Date) =>
  p.provider !== 'MANUAL' && (p.status === 'CREATING' || p.status === 'PENDING') && (!p.expiresAt || p.expiresAt > now) && !isStaleCreating(p, now)

export function toPaymentSummary(p: PaymentRow, now: Date): PaymentSummary {
  // An online attempt past its expiry or a stale CREATING row is dead even if the sweep/retry has not flipped the row yet.
  const staleCreating = isStaleCreating(p, now)
  const expired = !staleCreating && p.provider !== 'MANUAL' && (p.status === 'PENDING' || p.status === 'CREATING') && !!p.expiresAt && p.expiresAt <= now
  const paid = p.status === 'PAID' && p.paidAt
  const showUrl = p.provider === 'XENDIT' && p.status === 'PENDING' && !!p.expiresAt && p.expiresAt > now && !!p.checkoutUrl?.startsWith('https://')
  return {
    id: p.id,
    provider: p.provider,
    status: staleCreating ? 'FAILED' : expired ? 'EXPIRED' : p.status,
    checkoutUrl: showUrl ? p.checkoutUrl : null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    paidAt: p.paidAt?.toISOString() ?? null,
    receiptNumber: paid ? p.receiptNo : null,
    receiptNo: paid ? formatReceiptNo(p.receiptNo, p.paidAt!) : null,
    refundReason: p.refund?.reason ?? null,
  }
}
