import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { baseURL, cookieFrom, demoCookie, lastEmail, me, nextIp, pathOf, prisma, registerAndSignIn, request } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const PASSWORD = 'Sandi-rahasia-123'

describe('email + password sign-up', () => {
  it('queues a verification email in the outbox instead of sending inline', async () => {
    const res = await request('/api/auth/sign-up/email', { body: { name: 'Sari', email: 'sari@example.com', password: PASSWORD } })
    expect(res.status).toBe(200)
    const row = await lastEmail('verify-email', 'sari@example.com')
    expect(row?.status).toBe('PENDING')
    expect(row?.payload.url).toContain('/api/auth/verify-email?token=')
    expect(row?.payload.name).toBe('Sari')
  })

  it('refuses sign-in until the email is verified, then allows it', async () => {
    await request('/api/auth/sign-up/email', { body: { name: 'Sari', email: 'sari@example.com', password: PASSWORD } })

    const early = await request('/api/auth/sign-in/email', { body: { email: 'sari@example.com', password: PASSWORD } })
    expect(early.status).toBe(403)
    expect(cookieFrom(early)).toBe('')

    const mail = await lastEmail('verify-email', 'sari@example.com')
    const verify = await request(pathOf(mail!.payload.url))
    expect(verify.status).toBeLessThan(400)

    const ok = await request('/api/auth/sign-in/email', { body: { email: 'sari@example.com', password: PASSWORD } })
    expect(ok.status).toBe(200)
    const session = await me(cookieFrom(ok))
    expect(session?.user.email).toBe('sari@example.com')
    expect(session?.isOwner).toBe(false)
    expect(session?.campusVerified).toBe(false)
  })

  it('queues a password-reset email in the outbox', async () => {
    await registerAndSignIn('sari@example.com')
    const res = await request('/api/auth/request-password-reset', { body: { email: 'sari@example.com', redirectTo: '/' } })
    expect(res.status).toBe(200)
    const row = await lastEmail('reset-password', 'sari@example.com')
    expect(row?.status).toBe('PENDING')
    expect(row?.payload.url).toContain('/reset-password/')
  })
})

describe('auth.me', () => {
  it('is null without a session', async () => {
    expect(await me()).toBeNull()
  })

  it('is null for a garbage cookie', async () => {
    expect(await me('better-auth.session_token=nonsense.nonsense')).toBeNull()
  })
})

describe('rate limiting', () => {
  const attempt = (ip: string, extra: Record<string, string> = {}) =>
    request('/api/auth/sign-in/email', { ip, headers: extra, body: { email: 'nobody@example.com', password: 'salah-salah-1' } })

  it('limits sign-in per cf-connecting-ip and a spoofed X-Forwarded-For does not reset it', async () => {
    const ip = nextIp()
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) statuses.push((await attempt(ip, { 'x-forwarded-for': `203.0.113.${i + 1}` })).status)
    // 3 per 10 s by default: attempts 4 and 5 are throttled even though every XFF differs.
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true)
    expect(statuses.slice(3)).toEqual([429, 429])
  })

  it('keys the limit on the real client address: another cf-connecting-ip is unaffected', async () => {
    const ip = nextIp()
    for (let i = 0; i < 4; i++) await attempt(ip)
    expect((await attempt(ip)).status).toBe(429)
    expect((await attempt(nextIp())).status).not.toBe(429)
  })

  it('caps password-reset and verification emails at 3 per minute', async () => {
    for (const path of ['/api/auth/request-password-reset', '/api/auth/send-verification-email']) {
      const ip = nextIp()
      const statuses: number[] = []
      for (let i = 0; i < 4; i++) statuses.push((await request(path, { ip, body: { email: 'x@example.com' } })).status)
      expect(statuses[3], path).toBe(429)
      expect(statuses.slice(0, 3).every((s) => s !== 429), path).toBe(true)
    }
  })
})

describe('demo login', () => {
  it('signs in the demo owner with a real session that owns a kos', async () => {
    const res = await request('/api/auth/demo-login', { body: { as: 'owner' } })
    expect(res.status).toBe(200)
    expect(cookieFrom(res)).toContain('session_token=')
    const session = await me(cookieFrom(res))
    expect(session?.user.email).toBe('demo-owner@kobo.test')
    expect(session?.user.isDemo).toBe(true)
    expect(session?.isOwner).toBe(true)
    expect(session?.ownerProfileId).toBeTruthy()
    expect(await prisma.session.count({ where: { userId: session!.user.id } })).toBe(1)
  })

  it('signs in the campus-verified demo student, who is not an owner', async () => {
    const session = await me(await demoCookie('student'))
    expect(session?.user.email).toBe('demo-student@kobo.test')
    expect(session?.isOwner).toBe(false)
    expect(session?.ownerProfileId).toBeNull()
    expect(session?.campusVerified).toBe(true)
  })

  it('rejects an unknown persona', async () => {
    const res = await request('/api/auth/demo-login', { body: { as: 'admin' } })
    expect(res.status).toBe(400)
  })

  it('sign-out ends the session', async () => {
    const cookie = await demoCookie('owner')
    const out = await request('/api/auth/sign-out', { cookie, body: {} })
    expect(out.status).toBe(200)
    expect(await me(cookie)).toBeNull()
  })
})

describe('demo guards', () => {
  it('blocks a demo user from changing their password', async () => {
    const cookie = await demoCookie('owner')
    const res = await request('/api/auth/change-password', {
      cookie,
      body: { currentPassword: 'apa-saja-123', newPassword: 'Sandi-baru-12345', revokeOtherSessions: false },
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('DEMO_ACCOUNT_READONLY')
    const accounts = await prisma.account.count({ where: { user: { email: 'demo-owner@kobo.test' } } })
    expect(accounts).toBe(0) // still no way to sign in with a password
  })

  it('blocks email change, account deletion and campus-email changes for demo users', async () => {
    const cookie = await demoCookie('student')
    for (const [path, body] of [
      ['/api/auth/change-email', { newEmail: 'baru@example.com' }],
      ['/api/auth/delete-user', {}],
      ['/api/auth/campus-email/request', { email: 'x@student.binus.ac.id' }],
    ] as const) {
      const res = await request(path, { cookie, body })
      expect(res.status, path).toBe(403)
      expect(((await res.json()) as { code: string }).code, path).toBe('DEMO_ACCOUNT_READONLY')
    }
    expect(await prisma.user.count({ where: { email: 'demo-student@kobo.test' } })).toBe(1)
  })

  it('does not email password-reset links for demo accounts', async () => {
    const res = await request('/api/auth/request-password-reset', { body: { email: 'demo-owner@kobo.test', redirectTo: '/' } })
    expect(res.status).toBe(403)
    expect(await prisma.emailOutbox.count()).toBe(0)
  })

  it('does not stop ordinary users from changing their password', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    const res = await request('/api/auth/change-password', {
      cookie,
      ip: nextIp(),
      body: { currentPassword: PASSWORD, newPassword: 'Sandi-baru-12345', revokeOtherSessions: false },
    })
    expect(res.status).toBe(200)
  })
})

describe('password reset link', () => {
  it('lands on the SPA /reset-password page with the token, and the token sets a new password', async () => {
    await registerAndSignIn('sari@example.com')
    await request('/api/auth/request-password-reset', { body: { email: 'sari@example.com', redirectTo: '/reset-password' } })
    const row = await lastEmail('reset-password', 'sari@example.com')
    const click = await request(pathOf(row!.payload.url))
    expect(click.status).toBe(302)
    const location = new URL(click.headers.get('location')!, baseURL)
    expect(location.pathname).toBe('/reset-password')
    const token = location.searchParams.get('token')
    expect(token).toBeTruthy()

    const done = await request('/api/auth/reset-password', { body: { newPassword: 'Sandi-baru-456', token } })
    expect(done.status).toBe(200)
    expect((await request('/api/auth/sign-in/email', { body: { email: 'sari@example.com', password: 'Sandi-baru-456' } })).status).toBe(200)
  })

  it('redirects a bad token to /reset-password?error=INVALID_TOKEN', async () => {
    const click = await request('/api/auth/reset-password/not-a-token?callbackURL=%2Freset-password')
    expect(click.status).toBe(302)
    expect(click.headers.get('location')).toContain('error=INVALID_TOKEN')
  })
})
