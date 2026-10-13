import { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { resetDb } from '../../src/db/seed.ts'
import { MockPaymentProvider } from '../../src/payment/mock.ts'
import type { PaymentProvider } from '../../src/payment/provider.ts'
import { PaymentService } from '../../src/payment/service.ts'
import { auth, callerFor, prisma, storage } from '../helpers.ts'

const xenditStub: PaymentProvider = {
  kind: 'XENDIT',
  createCheckout: vi.fn(),
  getSession: vi.fn(),
  createRefund: vi.fn(),
}

const errorFrom = async (promise: Promise<unknown>) => (await promise.then(() => null, (error: unknown) => error)) as TRPCError | null

beforeEach(() => resetDb(prisma))

describe('payment provider dependency injection', () => {
  it('creates a stable in-app mock session without a redirect or network credentials', async () => {
    const provider = new MockPaymentProvider()
    const input = {
      paymentId: 'payment-123',
      amount: 1_250_000,
      currency: 'IDR' as const,
      expiresAt: new Date('2026-10-13T12:00:00.000Z'),
      successReturnUrl: 'https://kobo.test/my-kos',
      failureReturnUrl: 'https://kobo.test/my-kos',
    }

    expect(await provider.createCheckout(input)).toEqual(await provider.createCheckout(input))
    expect(await provider.createCheckout(input)).toMatchObject({
      providerSessionId: 'mock_session_payment-123',
      providerPaymentRequestId: null,
      checkoutUrl: null,
    })
  })

  it('uses the payment service injected into createApp when building an authenticated tRPC context', async () => {
    const paymentService = new PaymentService({ defaultProvider: xenditStub })
    const selected = vi.spyOn(paymentService, 'providerFor')
    const fakeAuth = {
      ...auth,
      api: {
        ...auth.api,
        getSession: vi.fn().mockResolvedValue({ user: { id: 'missing-demo', isDemo: true }, session: { userId: 'missing-demo' } }),
      },
    } as unknown as typeof auth
    const app = createApp({ prisma, auth: fakeAuth, storage, paymentService })
    const input = encodeURIComponent(JSON.stringify({ paymentId: 'missing' }))

    const response = await app.request(`/api/trpc/payment.status?input=${input}`)

    expect(response.status).toBe(404)
    expect(selected).toHaveBeenCalledOnce()
    expect(selected.mock.results[0].value.kind).toBe('MOCK')
  })

  it('selects MOCK for a demo caller and the configured default for a regular caller', async () => {
    const mock = new MockPaymentProvider()
    const paymentService = new PaymentService({ defaultProvider: xenditStub, mockProvider: mock })
    const selected = vi.spyOn(paymentService, 'providerFor')

    expect((await errorFrom(callerFor('missing-demo', { isDemo: true, paymentService }).payment.status({ paymentId: 'missing' })))?.code).toBe('NOT_FOUND')
    expect((await errorFrom(callerFor('missing-regular', { isDemo: false, paymentService }).payment.status({ paymentId: 'missing' })))?.code).toBe('NOT_FOUND')

    expect(selected.mock.results.map((result) => result.value.kind)).toEqual(['MOCK', 'XENDIT'])
  })
})
