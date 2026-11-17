export type OnlinePaymentProviderKind = 'MOCK' | 'XENDIT'
export type PaymentCurrency = 'IDR'

export interface CreateCheckoutInput {
  /** Stable KoBo Payment.id; providers use it as their idempotent reference. */
  paymentId: string
  amount: number
  currency: PaymentCurrency
  expiresAt: Date
  successReturnUrl: string
  failureReturnUrl: string
  providerBusinessId?: string
  splitRuleId?: string
}

export interface CheckoutSession {
  providerSessionId: string
  providerPaymentRequestId: string | null
  providerBusinessId: string | null
  /** Mock attempts stay inside KoBo and therefore have no redirect URL. */
  checkoutUrl: string | null
  expiresAt: Date
}

export interface GetSessionInput {
  providerSessionId: string
  providerBusinessId?: string
}

export interface PaymentSessionSnapshot {
  state: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'FAILED'
  referenceId: string
  providerSessionId: string
  providerPaymentRequestId: string | null
  providerPaymentId: string | null
  providerBusinessId: string | null
  amount: number | null
  currency: PaymentCurrency | null
  updatedAt: Date
}

export interface CreateRefundInput {
  /** Stable KoBo PaymentRefund.referenceId. */
  referenceId: string
  providerPaymentRequestId: string
  providerBusinessId?: string
  amount: number
  currency: PaymentCurrency
  reason: 'FRAUDULENT' | 'DUPLICATE' | 'REQUESTED_BY_CUSTOMER' | 'CANCELLATION' | 'OTHERS'
}

export interface RefundSnapshot {
  providerRefundId: string
  state: 'PENDING' | 'SUCCEEDED' | 'FAILED'
  updatedAt: Date
}

/** Server-only adapter. Browser code never receives credentials or raw provider responses. */
export interface PaymentProvider {
  readonly kind: OnlinePaymentProviderKind
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>
  getSession(input: GetSessionInput): Promise<PaymentSessionSnapshot>
  createRefund(input: CreateRefundInput): Promise<RefundSnapshot>
}

interface EventBase {
  referenceId: string
  providerBusinessId: string
  amount: number
  currency: PaymentCurrency
  occurredAt: Date
}

export type NormalizedPaymentEvent =
  | (EventBase & {
      kind: 'SESSION_COMPLETED'
      providerSessionId: string
      providerPaymentRequestId: string
      providerPaymentId: string
    })
  | (EventBase & {
      kind: 'SESSION_EXPIRED'
      providerSessionId: string
    })
  | (EventBase & {
      kind: 'REFUND_SUCCEEDED'
      providerRefundId: string
      providerPaymentRequestId: string
    })
  | (EventBase & {
      kind: 'REFUND_FAILED'
      providerRefundId: string
      providerPaymentRequestId: string
      failureCode: string | null
    })
