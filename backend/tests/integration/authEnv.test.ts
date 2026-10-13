import { describe, expect, it } from 'vitest'
import { authEnv } from '../../src/env.ts'

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
