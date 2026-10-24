import { describe, expect, it, vi } from 'vitest'
import { createE2eHooks, E2E_BUSINESS_ID, E2E_CALLBACK_TOKEN, FakeXenditProvider } from '../../src/e2eHooks.ts'
import { e2eHooksEnabled } from '../../src/env.ts'
import { XenditError } from '../../src/payment/xendit.ts'

// No database: the fake provider only reads Payment rows, stubbed here.
const stubPrisma = (payment: { invoiceId?: string; amount?: number } | null = { invoiceId: 'inv_1', amount: 1_500_000 }) =>
  ({ payment: { findUnique: vi.fn().mockResolvedValue(payment) } }) as never

const checkoutInput = (paymentId = 'pay_1') => ({
  paymentId,
  amount: 1_500_000,
  currency: 'IDR' as const,
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  successReturnUrl: 'http://localhost:3100/my-kos?payment=pay_1&result=success',
  failureReturnUrl: 'http://localhost:3100/my-kos?payment=pay_1&result=cancel',
})

describe('e2eHooksEnabled', () => {
  const base = { DATABASE_URL: 'postgresql://kobo:kobo@localhost:5433/kobo_e2e' }

  it('is off unless ALLOW_E2E_HOOKS is exactly 1, whatever else is set', () => {
    expect(e2eHooksEnabled({ ...base })).toBe(false)
    expect(e2eHooksEnabled({ ...base, ALLOW_E2E_HOOKS: '' })).toBe(false)
    expect(e2eHooksEnabled({ ...base, ALLOW_E2E_HOOKS: 'true' })).toBe(false)
    expect(e2eHooksEnabled({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'xendit' })).toBe(false)
  })

  it('turns on for mock payments with a loopback database', () => {
    expect(e2eHooksEnabled({ ...base, ALLOW_E2E_HOOKS: '1' })).toBe(true)
    expect(e2eHooksEnabled({ ...base, ALLOW_E2E_HOOKS: '1', PAYMENT_PROVIDER: 'mock', NODE_ENV: 'test' })).toBe(true)
  })

  it('refuses a real payment provider', () => {
    const env = { ...base, ALLOW_E2E_HOOKS: '1', PAYMENT_PROVIDER: 'xendit', XENDIT_SECRET_API_KEY: 'xnd_development_x', XENDIT_CALLBACK_TOKEN: 't', XENDIT_BUSINESS_ID: 'b' }
    expect(() => e2eHooksEnabled(env)).toThrow(/PAYMENT_PROVIDER=mock/)
  })

  it('needs ALLOW_MOCK_PAYMENTS too in production mode', () => {
    const env = { ...base, ALLOW_E2E_HOOKS: '1', NODE_ENV: 'production' }
    expect(() => e2eHooksEnabled(env)).toThrow(/ALLOW_MOCK_PAYMENTS/)
    expect(e2eHooksEnabled({ ...env, ALLOW_MOCK_PAYMENTS: '1' })).toBe(true)
  })

  it('refuses a non-loopback or missing database', () => {
    expect(() => e2eHooksEnabled({ ALLOW_E2E_HOOKS: '1', DATABASE_URL: 'postgresql://u:p@db.example.com:5432/kobo' })).toThrow(/loopback/)
    expect(() => e2eHooksEnabled({ ALLOW_E2E_HOOKS: '1' })).toThrow(/DATABASE_URL/)
  })
})

describe('FakeXenditProvider', () => {
  it('creates a staging checkout URL carrying both return links', async () => {
    const session = await new FakeXenditProvider(stubPrisma()).createCheckout(checkoutInput())
    expect(session).toMatchObject({ providerSessionId: 'ps_e2e_pay_1', providerPaymentRequestId: null, providerBusinessId: E2E_BUSINESS_ID })
    const url = new URL(session.checkoutUrl!)
    expect(url.origin).toBe('https://checkout-staging.xendit.co')
    expect(url.searchParams.get('success')).toBe(checkoutInput().successReturnUrl)
    expect(url.searchParams.get('failure')).toBe(checkoutInput().failureReturnUrl)
  })

  it('fails the next checkout of a flagged invoice once, as a retryable outage', async () => {
    const provider = new FakeXenditProvider(stubPrisma())
    provider.failCheckout.add('inv_1')
    const error = await provider.createCheckout(checkoutInput()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(XenditError)
    expect(error).toMatchObject({ operation: 'CREATE_SESSION', retryable: true, outcomeUnknown: false })
    await expect(provider.createCheckout(checkoutInput())).resolves.toMatchObject({ providerSessionId: 'ps_e2e_pay_1' })
  })

  it('reports ACTIVE without an amount, and COMPLETED / EXPIRED with the payment amount', async () => {
    const provider = new FakeXenditProvider(stubPrisma())
    const ask = () => provider.getSession({ providerSessionId: 'ps_e2e_pay_1' })
    expect(await ask()).toMatchObject({ state: 'ACTIVE', referenceId: 'pay_1', amount: null })
    provider.sessions.set('pay_1', 'COMPLETED')
    expect(await ask()).toMatchObject({ state: 'COMPLETED', amount: 1_500_000, providerPaymentRequestId: 'pr_e2e_pay_1', providerPaymentId: 'py_e2e_pay_1' })
    provider.sessions.set('pay_1', 'EXPIRED')
    expect(await ask()).toMatchObject({ state: 'EXPIRED', amount: 1_500_000 })
  })

  it('answers refunds per mode: SUCCEEDED by default, PENDING, FAILED, ERROR throws', async () => {
    const provider = new FakeXenditProvider(stubPrisma())
    const refund = () => provider.createRefund({ referenceId: 'ref_1', providerPaymentRequestId: 'pr_e2e_pay_1', amount: 1_500_000, currency: 'IDR', reason: 'CANCELLATION' })
    expect(await refund()).toMatchObject({ providerRefundId: 'rf_e2e_ref_1', state: 'SUCCEEDED' })
    for (const mode of ['PENDING', 'FAILED'] as const) {
      provider.refundModes.set('pay_1', mode)
      expect(await refund()).toMatchObject({ state: mode })
    }
    provider.refundModes.set('pay_1', 'ERROR')
    await expect(refund()).rejects.toMatchObject({ operation: 'CREATE_REFUND', retryable: false })
  })
})

describe('createE2eHooks', () => {
  it('routes real users to the fake provider, demo users to mock, and accepts the e2e webhook token', () => {
    const hooks = createE2eHooks(stubPrisma())
    expect(hooks.paymentService.providerFor({ isDemo: false })).toBe(hooks.provider)
    expect(hooks.paymentService.providerFor({ isDemo: true }).kind).toBe('MOCK')
    expect(hooks.paymentService.xenditWebhook).toEqual({ callbackToken: E2E_CALLBACK_TOKEN, businessId: E2E_BUSINESS_ID })
  })
})
