import { paymentEnv } from '../env.ts'
import { MockPaymentProvider } from './mock.ts'
import type { PaymentProvider } from './provider.ts'
import type { XenditWebhookConfig } from './webhook.ts'
import { XenditPaymentProvider } from './xendit.ts'

export interface PaymentServiceOptions {
  defaultProvider: PaymentProvider
  mockProvider?: PaymentProvider
  /** Credentials for POST /api/webhooks/xendit; null/absent leaves the route answering 404. */
  xenditWebhook?: XenditWebhookConfig | null
}

/** Owns provider selection; domain/payment state transitions are added in later tasks. */
export class PaymentService {
  readonly defaultProvider: PaymentProvider
  readonly mockProvider: PaymentProvider
  readonly xenditWebhook: XenditWebhookConfig | null

  constructor({ defaultProvider, mockProvider = new MockPaymentProvider(), xenditWebhook = null }: PaymentServiceOptions) {
    if (mockProvider.kind !== 'MOCK') throw new Error('mockProvider must be a MOCK payment provider')
    this.defaultProvider = defaultProvider
    this.mockProvider = mockProvider
    this.xenditWebhook = xenditWebhook
  }

  providerFor(user: { isDemo: boolean }): PaymentProvider {
    return user.isDemo ? this.mockProvider : this.defaultProvider
  }
}

export function paymentServiceFromEnv(config = paymentEnv()): PaymentService {
  const mock = new MockPaymentProvider()
  const defaultProvider =
    config.provider === 'mock'
      ? mock
      : new XenditPaymentProvider({
          secretApiKey: config.xendit.secretApiKey,
          businessId: config.xendit.businessId,
          apiBaseUrl: config.xendit.apiBaseUrl,
        })
  const xenditWebhook = config.provider === 'xendit' ? { callbackToken: config.xendit.callbackToken, businessId: config.xendit.businessId } : null
  return new PaymentService({ defaultProvider, mockProvider: mock, xenditWebhook })
}
