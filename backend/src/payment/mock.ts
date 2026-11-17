import type {
  CheckoutSession,
  CreateCheckoutInput,
  CreateRefundInput,
  GetSessionInput,
  NormalizedPaymentEvent,
  PaymentProvider,
  PaymentSessionSnapshot,
  RefundSnapshot,
} from './provider.ts'

export const MOCK_BUSINESS_ID = 'kobo-mock'

/** Deterministic, network-free adapter for automated tests and explicitly demo users. */
/** The normalized completed event the in-app simulator feeds to settlement (there is no mock gateway to call back). */
export function mockCompletedEvent(payment: { id: string; amount: number; providerSessionId: string | null; providerBusinessId: string | null }, now: Date): NormalizedPaymentEvent {
  return {
    kind: 'SESSION_COMPLETED',
    referenceId: payment.id,
    providerBusinessId: payment.providerBusinessId ?? MOCK_BUSINESS_ID,
    amount: payment.amount,
    currency: 'IDR',
    occurredAt: now,
    providerSessionId: payment.providerSessionId ?? `mock_session_${payment.id}`,
    providerPaymentRequestId: `mock_pr_${payment.id}`,
    providerPaymentId: `mock_pay_${payment.id}`,
  }
}

export class MockPaymentProvider implements PaymentProvider {
  readonly kind = 'MOCK' as const

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    return {
      providerSessionId: `mock_session_${input.paymentId}`,
      providerPaymentRequestId: null,
      providerBusinessId: MOCK_BUSINESS_ID,
      checkoutUrl: null,
      expiresAt: input.expiresAt,
    }
  }

  async getSession(input: GetSessionInput): Promise<PaymentSessionSnapshot> {
    return {
      state: 'ACTIVE',
      referenceId: input.providerSessionId.replace(/^mock_session_/, ''),
      providerSessionId: input.providerSessionId,
      providerPaymentRequestId: null,
      providerPaymentId: null,
      providerBusinessId: MOCK_BUSINESS_ID,
      amount: null,
      currency: null,
      updatedAt: new Date(0),
    }
  }

  async createRefund(input: CreateRefundInput): Promise<RefundSnapshot> {
    return {
      providerRefundId: `mock_refund_${input.referenceId}`,
      state: 'SUCCEEDED',
      updatedAt: new Date(0),
    }
  }
}
