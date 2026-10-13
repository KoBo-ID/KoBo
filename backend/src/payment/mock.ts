import type {
  CheckoutSession,
  CreateCheckoutInput,
  CreateRefundInput,
  GetSessionInput,
  PaymentProvider,
  PaymentSessionSnapshot,
  RefundSnapshot,
} from './provider.ts'

const MOCK_BUSINESS_ID = 'kobo-mock'

/** Deterministic, network-free adapter for automated tests and explicitly demo users. */
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
