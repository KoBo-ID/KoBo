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
}

export interface PaymentRow {
  id: string
  provider: PaymentSummary['provider']
  status: PaymentSummary['status']
  checkoutUrl: string | null
  expiresAt: Date | null
  paidAt: Date | null
  receiptNo: number
}

/** Whether an attempt is still open for the tenant: CREATING/PENDING and not past its expiry (null expiry = open). */
export const isLiveAttempt = (p: Pick<PaymentRow, 'provider' | 'status' | 'expiresAt'>, now: Date) =>
  p.provider !== 'MANUAL' && (p.status === 'CREATING' || p.status === 'PENDING') && (!p.expiresAt || p.expiresAt > now)

export function toPaymentSummary(p: PaymentRow, now: Date): PaymentSummary {
  const paid = p.status === 'PAID' && p.paidAt
  const showUrl = p.provider === 'XENDIT' && p.status === 'PENDING' && !!p.expiresAt && p.expiresAt > now && !!p.checkoutUrl?.startsWith('https://')
  return {
    id: p.id,
    provider: p.provider,
    status: p.status,
    checkoutUrl: showUrl ? p.checkoutUrl : null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    paidAt: p.paidAt?.toISOString() ?? null,
    receiptNumber: paid ? p.receiptNo : null,
    receiptNo: paid ? formatReceiptNo(p.receiptNo, p.paidAt!) : null,
  }
}
