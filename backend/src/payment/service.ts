import { paymentEnv } from '../env.ts'
import { MockPaymentProvider } from './mock.ts'
import type {
  CheckoutSession,
  CreateCheckoutInput,
  CreateRefundInput,
  GetSessionInput,
  PaymentProvider,
  PaymentSessionSnapshot,
  RefundSnapshot,
} from './provider.ts'

export interface PaymentServiceOptions {
  defaultProvider: PaymentProvider
  mockProvider?: PaymentProvider
}

/** Owns provider selection; domain/payment state transitions are added in later tasks. */
export class PaymentService {
  readonly defaultProvider: PaymentProvider
  readonly mockProvider: PaymentProvider

  constructor({ defaultProvider, mockProvider = new MockPaymentProvider() }: PaymentServiceOptions) {
    if (mockProvider.kind !== 'MOCK') throw new Error('mockProvider must be a MOCK payment provider')
    this.defaultProvider = defaultProvider
    this.mockProvider = mockProvider
  }

  providerFor(user: { isDemo: boolean }): PaymentProvider {
    return user.isDemo ? this.mockProvider : this.defaultProvider
  }
}

/**
 * Fail-closed bridge until Task 3 supplies the real REST adapter. This makes environment wiring complete without
 * accidentally pretending that an Xendit checkout or refund succeeded.
 */
class PendingXenditProvider implements PaymentProvider {
  readonly kind = 'XENDIT' as const

  private unavailable(): never {
    throw new Error('Xendit payment provider is not available until its REST adapter is configured.')
  }

  async createCheckout(_input: CreateCheckoutInput): Promise<CheckoutSession> {
    return this.unavailable()
  }
  async getSession(_input: GetSessionInput): Promise<PaymentSessionSnapshot> {
    return this.unavailable()
  }
  async createRefund(_input: CreateRefundInput): Promise<RefundSnapshot> {
    return this.unavailable()
  }
}

export function paymentServiceFromEnv(config = paymentEnv()): PaymentService {
  const mock = new MockPaymentProvider()
  return new PaymentService({ defaultProvider: config.provider === 'mock' ? mock : new PendingXenditProvider(), mockProvider: mock })
}
