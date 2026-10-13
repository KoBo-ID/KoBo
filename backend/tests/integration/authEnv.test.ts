import { describe, expect, it } from 'vitest'
import { authEnv, paymentEnv } from '../../src/env.ts'

const secret = 'test-secret-test-secret-test-secret-0123456789'
const prod = (extra: Record<string, string>) => ({ NODE_ENV: 'production', BETTER_AUTH_SECRET: secret, ...extra })

describe('authEnv', () => {
  it('accepts a public https origin in production and strips a trailing slash', () => {
    const env = authEnv(prod({ BETTER_AUTH_URL: 'https://kobo.vercel.app/' }))
    expect(env.baseURL).toBe('https://kobo.vercel.app')
    expect(env.trustedOrigins).toEqual([])
    expect(env.ipAddressHeaders).toBeUndefined()
  })

  it.each(['http://kobo.vercel.app', 'https://localhost:5173', 'https://127.0.0.1', 'http://localhost:3000', 'https://kobo.vercel.app/api', 'kobo.vercel.app'])(
    'refuses %s in production',
    (url) => {
      expect(() => authEnv(prod({ BETTER_AUTH_URL: url }))).toThrow(/public site origin/)
    },
  )

  it('allows an http localhost URL in production only with the explicit opt-in', () => {
    expect(authEnv(prod({ BETTER_AUTH_URL: 'http://localhost:3100', ALLOW_INSECURE_AUTH_URL: '1' })).baseURL).toBe('http://localhost:3100')
  })

  it('does not validate outside production and keeps the Vite origin trusted', () => {
    const env = authEnv({ NODE_ENV: 'development', BETTER_AUTH_URL: 'http://localhost:5173', BETTER_AUTH_SECRET: secret })
    expect(env.trustedOrigins).toEqual(['http://localhost:5173'])
  })

  it('merges TRUSTED_ORIGINS: trimmed, empty entries and trailing slashes dropped, no duplicates', () => {
    const extra = ' https://kobo-git-main.vercel.app/ ,, https://preview.kobo.id ,https://preview.kobo.id'
    expect(authEnv(prod({ BETTER_AUTH_URL: 'https://kobo.vercel.app', TRUSTED_ORIGINS: extra })).trustedOrigins).toEqual([
      'https://kobo-git-main.vercel.app',
      'https://preview.kobo.id',
    ])
    expect(authEnv({ BETTER_AUTH_URL: 'http://localhost:5173', BETTER_AUTH_SECRET: secret, TRUSTED_ORIGINS: 'http://localhost:4173' }).trustedOrigins).toEqual([
      'http://localhost:5173',
      'http://localhost:4173',
    ])
  })

  it('parses AUTH_IP_HEADERS; blank means the createAuth default', () => {
    expect(authEnv(prod({ BETTER_AUTH_URL: 'https://kobo.vercel.app', AUTH_IP_HEADERS: ' X-Forwarded-For , x-real-ip ' })).ipAddressHeaders).toEqual([
      'x-forwarded-for',
      'x-real-ip',
    ])
    expect(authEnv(prod({ BETTER_AUTH_URL: 'https://kobo.vercel.app', AUTH_IP_HEADERS: ' , ' })).ipAddressHeaders).toBeUndefined()
  })
})

describe('paymentEnv', () => {
  it('defaults safely to the mock provider in test mode', () => {
    expect(paymentEnv({ NODE_ENV: 'development' })).toEqual({
      provider: 'mock',
      xendit: { mode: 'test', apiBaseUrl: 'https://api.xendit.co' },
    })
  })

  it('refuses mock payments in production without the explicit test-only switch', () => {
    expect(() => paymentEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' })).toThrow(/ALLOW_MOCK_PAYMENTS=1/)
    expect(paymentEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock', ALLOW_MOCK_PAYMENTS: '1' }).provider).toBe('mock')
  })

  it('requires Xendit credentials when Xendit is the default provider', () => {
    expect(() => paymentEnv({ PAYMENT_PROVIDER: 'xendit' })).toThrow(/XENDIT_SECRET_API_KEY/)

    expect(
      paymentEnv({
        PAYMENT_PROVIDER: 'xendit',
        XENDIT_SECRET_API_KEY: 'xnd_development_secret',
        XENDIT_CALLBACK_TOKEN: 'callback-token',
        XENDIT_BUSINESS_ID: 'business-id',
      }),
    ).toMatchObject({
      provider: 'xendit',
      xendit: {
        mode: 'test',
        secretApiKey: 'xnd_development_secret',
        callbackToken: 'callback-token',
        businessId: 'business-id',
      },
    })
  })

  it.each(['stripe', 'manual', ''])('rejects an invalid PAYMENT_PROVIDER value (%s)', (provider) => {
    expect(() => paymentEnv({ PAYMENT_PROVIDER: provider })).toThrow(/PAYMENT_PROVIDER/)
  })

  it('requires the explicit safety switch for live Xendit mode', () => {
    const env = {
      PAYMENT_PROVIDER: 'xendit',
      XENDIT_MODE: 'live',
      XENDIT_SECRET_API_KEY: 'xnd_production_secret',
      XENDIT_CALLBACK_TOKEN: 'callback-token',
      XENDIT_BUSINESS_ID: 'business-id',
    }
    expect(() => paymentEnv(env)).toThrow(/ENABLE_XENDIT_LIVE=1/)
    expect(paymentEnv({ ...env, ENABLE_XENDIT_LIVE: '1' }).xendit.mode).toBe('live')
  })

  it('requires the API-key prefix to match Xendit mode', () => {
    const common = {
      PAYMENT_PROVIDER: 'xendit',
      XENDIT_CALLBACK_TOKEN: 'callback-token',
      XENDIT_BUSINESS_ID: 'business-id',
    }
    expect(() => paymentEnv({ ...common, XENDIT_MODE: 'test', XENDIT_SECRET_API_KEY: 'xnd_production_secret' })).toThrow(/xnd_development_/)
    expect(() =>
      paymentEnv({ ...common, XENDIT_MODE: 'live', XENDIT_SECRET_API_KEY: 'xnd_development_secret', ENABLE_XENDIT_LIVE: '1' }),
    ).toThrow(/xnd_production_/)
  })

  it.each(['XENDIT_SECRET_API_KEY', 'XENDIT_CALLBACK_TOKEN', 'XENDIT_BUSINESS_ID'] as const)('rejects a blank %s', (name) => {
    const env = {
      PAYMENT_PROVIDER: 'xendit',
      XENDIT_SECRET_API_KEY: 'xnd_development_secret',
      XENDIT_CALLBACK_TOKEN: 'callback-token',
      XENDIT_BUSINESS_ID: 'business-id',
      [name]: '   ',
    }
    expect(() => paymentEnv(env)).toThrow(new RegExp(name))
  })

  it('trims validated Xendit credentials', () => {
    const config = paymentEnv({
      PAYMENT_PROVIDER: 'xendit',
      XENDIT_SECRET_API_KEY: '  xnd_development_secret  ',
      XENDIT_CALLBACK_TOKEN: '  callback-token  ',
      XENDIT_BUSINESS_ID: '  business-id  ',
    })
    expect(config.provider).toBe('xendit')
    if (config.provider !== 'xendit') throw new Error('expected xendit config')
    expect(config.xendit).toMatchObject({
      secretApiKey: 'xnd_development_secret',
      callbackToken: 'callback-token',
      businessId: 'business-id',
    })
  })

  it('allows a custom API base URL only on a test loopback host', () => {
    expect(paymentEnv({ NODE_ENV: 'test', XENDIT_API_BASE_URL: 'http://127.0.0.1:9999/' }).xendit.apiBaseUrl).toBe('http://127.0.0.1:9999')
    expect(() => paymentEnv({ NODE_ENV: 'development', XENDIT_API_BASE_URL: 'http://127.0.0.1:9999/' })).toThrow(/NODE_ENV=test/)
    expect(() => paymentEnv({ NODE_ENV: 'test', XENDIT_API_BASE_URL: 'https://proxy.example.com' })).toThrow(/loopback/)
    expect(() => paymentEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock', ALLOW_MOCK_PAYMENTS: '1', XENDIT_API_BASE_URL: 'https://proxy.example.com' })).toThrow(
      /XENDIT_API_BASE_URL/,
    )
  })
})
