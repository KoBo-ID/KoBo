import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import '../../src/env.ts'
import { XenditPaymentProvider } from '../../src/payment/xendit.ts'

// Real Xendit Test Mode contract test (mirrors tests/contract/r2.test.ts):
// Opt-in only so regular `npm test` stays network-free and never creates sessions in your Xendit dashboard.
// Run manually from backend/ with:
//   $env:RUN_XENDIT_CONTRACT='1'; npx vitest run tests/contract/xendit.test.ts
const secretApiKey = process.env.XENDIT_SECRET_API_KEY?.trim() ?? ''
const businessId = process.env.XENDIT_BUSINESS_ID?.trim() ?? ''
const returnOrigin = (process.env.PAYMENT_RETURN_ORIGIN ?? process.env.BETTER_AUTH_URL ?? '').trim().replace(/\/+$/, '')

const configured =
  process.env.RUN_XENDIT_CONTRACT === '1' &&
  secretApiKey.startsWith('xnd_development_') &&
  businessId.length > 0 &&
  returnOrigin.startsWith('https://')

describe.skipIf(!configured)('Xendit Payment Sessions (real Test Mode API)', () => {
  it('creates an IDR hosted checkout session and reads it back via GET /sessions/:id', async () => {
    const provider = new XenditPaymentProvider({ secretApiKey, businessId })
    const paymentId = `kobo_ct_${randomUUID().replace(/-/g, '').slice(0, 20)}`
    const expiresAt = new Date(Date.now() + 25 * 60_000)
    const base = `${returnOrigin}/my-kos?payment=${encodeURIComponent(paymentId)}`

    const session = await provider.createCheckout({
      paymentId,
      amount: 100_000,
      currency: 'IDR',
      expiresAt,
      successReturnUrl: `${base}&result=success`,
      failureReturnUrl: `${base}&result=cancel`,
    })

    expect(session.providerSessionId).toBeTruthy()
    expect(session.providerBusinessId).toBe(businessId)
    expect(session.checkoutUrl).toMatch(/^https:\/\//)
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(expiresAt.getTime())

    const snapshot = await provider.getSession({ providerSessionId: session.providerSessionId })
    expect(snapshot).toMatchObject({
      state: 'ACTIVE',
      referenceId: paymentId,
      providerSessionId: session.providerSessionId,
      providerBusinessId: businessId,
      amount: 100_000,
      currency: 'IDR',
    })
  })
})
