import { paymentEnv } from '../env.ts'
import { MockPaymentProvider } from './mock.ts'
import type { PaymentProvider } from './provider.ts'
import { XenditPaymentProvider } from './xendit.ts'

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
  return new PaymentService({ defaultProvider, mockProvider: mock })
}
