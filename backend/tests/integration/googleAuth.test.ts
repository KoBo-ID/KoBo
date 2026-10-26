import { beforeEach, describe, expect, it } from 'vitest'
import { createAuth } from '../../src/auth.ts'
import { resetDb } from '../../src/db/seed.ts'
import { baseURL, caller, demoCookie, nextIp, prisma, secret } from '../helpers.ts'
import { createCallerFactory } from '../../src/trpc/trpc.ts'
import { appRouter } from '../../src/trpc/router.ts'
import { createFakeStorage } from '../../src/storage.ts'
import { NoGeocoder } from '../../src/geocode.ts'
import { PaymentService } from '../../src/payment/service.ts'
import { MockPaymentProvider } from '../../src/payment/mock.ts'

// Fake client ids: nothing here talks to Google. The sign-in call only builds the authorization URL.
const google = { clientId: 'fake-client-id.apps.googleusercontent.com', clientSecret: 'fake-secret' }
const googleAuth = createAuth({ prisma, baseURL, secret, google })

beforeEach(() => resetDb(prisma))

function callerWith(auth: ReturnType<typeof createAuth>) {
  const paymentService = new PaymentService({ defaultProvider: new MockPaymentProvider(), xenditWebhook: { callbackToken: 'x', businessId: 'b' } })
  return createCallerFactory(appRouter)({
    prisma, auth, storage: createFakeStorage(), paymentService, geocoder: new NoGeocoder(), headers: new Headers(), resHeaders: new Headers(), getSession: async () => null,
  })
}

describe('auth.providers', () => {
  it('reports Google off by default and exposes nothing else', async () => {
    expect(await caller.auth.providers()).toEqual({ google: false })
  })

  it('reports Google on when createAuth receives a Google config, without leaking the credentials', async () => {
    const res = await callerWith(googleAuth).auth.providers()
    expect(res).toEqual({ google: true })
    expect(JSON.stringify(res)).not.toContain('fake')
  })
})

describe('Google provider wiring', () => {
  it('registers the provider only when configured and turns linking on for it', () => {
    expect(googleAuth.options.socialProviders?.google?.clientId).toBe(google.clientId)
    expect(googleAuth.options.account?.accountLinking).toMatchObject({ enabled: true, trustedProviders: ['google'], requireLocalEmailVerified: true })
    expect(createAuth({ prisma, baseURL, secret }).options.socialProviders?.google).toBeUndefined()
  })

  it('starts the OAuth flow with the /api/auth/callback/google redirect URI and the right scopes', async () => {
    const res = await googleAuth.handler(
      new Request(`${baseURL}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { origin: baseURL, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
        body: JSON.stringify({ provider: 'google', callbackURL: `${baseURL}/kos`, errorCallbackURL: `${baseURL}/kos?google=gagal` }),
      }),
    )
    expect(res.status).toBe(200)
    const { url, redirect } = (await res.json()) as { url: string; redirect: boolean }
    expect(redirect).toBe(true)
    const target = new URL(url)
    expect(target.origin + target.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(target.searchParams.get('client_id')).toBe(google.clientId)
    expect(target.searchParams.get('redirect_uri')).toBe(`${baseURL}/api/auth/callback/google`)
    expect(target.searchParams.get('scope')).toContain('email')
    expect(target.searchParams.get('state')).toBeTruthy()
  })

  it('has no Google sign-in when unconfigured', async () => {
    const res = await createAuth({ prisma, baseURL, secret }).handler(
      new Request(`${baseURL}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { origin: baseURL, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
        body: JSON.stringify({ provider: 'google', callbackURL: `${baseURL}/kos` }),
      }),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('refuses to link a Google account to a demo user', async () => {
    const cookie = await demoCookie('student')
    const res = await googleAuth.handler(
      new Request(`${baseURL}/api/auth/link-social`, {
        method: 'POST',
        headers: { origin: baseURL, 'content-type': 'application/json', cookie, 'cf-connecting-ip': nextIp() },
        body: JSON.stringify({ provider: 'google', callbackURL: `${baseURL}/kos` }),
      }),
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('DEMO_ACCOUNT_READONLY')
  })
})
