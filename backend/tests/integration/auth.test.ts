import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TERMS_VERSION } from '@kobo/shared/domain'
import { createAuth } from '../../src/auth.ts'
import { resetDb } from '../../src/db/seed.ts'
import { baseURL, cookieFrom, demoCookie, lastEmail, me, nextIp, pathOf, prisma, registerAndSignIn, request, secret, verifyEmailWithCode } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const PASSWORD = 'Sandi-rahasia-123'

describe('email + password sign-up', () => {
  it('queues a verification email in the outbox instead of sending inline', async () => {
    const res = await request('/api/auth/sign-up/email', { body: { name: 'Sari', email: 'sari@example.com', password: PASSWORD } })
    expect(res.status).toBe(200)
    const row = await lastEmail('verify-email', 'sari@example.com')
    expect(row?.status).toBe('PENDING')
    expect(row?.payload.code).toMatch(/^\d{6}$/)
    expect(row?.payload.url).toBeUndefined()
    expect(row?.payload.name).toBe('Sari')
  })

  it('stores the Syarat version only when the sign-up sends the current one', async () => {
    await request('/api/auth/sign-up/email', { body: { name: 'Sari', email: 'sari@example.com', password: PASSWORD, termsVersion: TERMS_VERSION } })
    await request('/api/auth/sign-up/email', { body: { name: 'Budi', email: 'budi@example.com', password: PASSWORD, termsVersion: 'versi-palsu' } })
    const sari = await prisma.user.findUniqueOrThrow({ where: { email: 'sari@example.com' } })
    const budi = await prisma.user.findUniqueOrThrow({ where: { email: 'budi@example.com' } })
    expect([sari.termsVersion, sari.termsAcceptedAt !== null]).toEqual([TERMS_VERSION, true])
    expect([budi.termsVersion, budi.termsAcceptedAt]).toEqual([null, null])
  })

  it('refuses sign-in until the email is verified, then allows it', async () => {
    await request('/api/auth/sign-up/email', { body: { name: 'Sari', email: 'sari@example.com', password: PASSWORD } })

    const early = await request('/api/auth/sign-in/email', { body: { email: 'sari@example.com', password: PASSWORD } })
    expect(early.status).toBe(403)
    expect(cookieFrom(early)).toBe('')

    const verify = await verifyEmailWithCode('sari@example.com')
    expect(verify.status).toBe(200)

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

describe('resending the verification email', () => {
  it('queues a NEW verify-email row with a fresh code that verifies the account', async () => {
    await request('/api/auth/sign-up/email', { body: { name: 'Sari', email: 'sari@example.com', password: PASSWORD } })
    const first = await lastEmail('verify-email', 'sari@example.com')

    const res = await request('/api/auth/send-verification-email', { body: { email: 'sari@example.com', callbackURL: '/verifikasi-email' } })
    expect(res.status).toBe(200)
    expect(await prisma.emailOutbox.count({ where: { template: 'verify-email', to: 'sari@example.com' } })).toBe(2)
    const second = await lastEmail('verify-email', 'sari@example.com')
    expect(second?.id).not.toBe(first?.id)
    expect(second?.status).toBe('PENDING')
    expect(second?.payload.url).toBeUndefined()

    expect((await verifyEmailWithCode('sari@example.com')).status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'sari@example.com' } })).emailVerified).toBe(true)
  })
})

describe('emailed links', () => {
  // A link built on the wrong origin (e.g. localhost on Railway) "goes nowhere"; the reset link must use baseURL.
  it('the reset-password link starts with the configured baseURL; verify-email carries a code and no link', async () => {
    await registerAndSignIn('sari@example.com')
    await request('/api/auth/request-password-reset', { body: { email: 'sari@example.com', redirectTo: '/reset-password' } })
    expect((await lastEmail('reset-password', 'sari@example.com'))?.payload.url.startsWith(`${baseURL}/`)).toBe(true)
    expect((await lastEmail('verify-email', 'sari@example.com'))?.payload.url).toBeUndefined()
  })
})

describe('code-only email verification', () => {
  const signUp = (email = 'sari@example.com') => request('/api/auth/sign-up/email', { body: { name: 'Sari', email, password: PASSWORD } })
  const otp = (body: object, ip = nextIp()) => request('/api/auth/email-otp/verify-email', { ip, body })
  const verified = async () => (await prisma.user.findUniqueOrThrow({ where: { email: 'sari@example.com' } })).emailVerified

  it('a correct code verifies, signs in and sets the session cookie', async () => {
    await signUp()
    const res = await verifyEmailWithCode('sari@example.com')
    expect(res.status).toBe(200)
    expect(cookieFrom(res)).not.toBe('')
    expect((await me(cookieFrom(res)))?.user.email).toBe('sari@example.com')
    expect(await verified()).toBe(true)
  })

  it('a wrong code 5 times kills the code, even the right one', async () => {
    await signUp()
    const good = (await lastEmail('verify-email', 'sari@example.com'))!.payload.code
    const wrong = good === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) expect((await otp({ email: 'sari@example.com', otp: wrong })).status).toBe(400)
    expect((await otp({ email: 'sari@example.com', otp: good })).status).toBe(403) // TOO_MANY_ATTEMPTS: the code is dead
    expect(await verified()).toBe(false)
  })

  it('one wrong code, then the right one still verifies (e2e onboarding:27)', async () => {
    await signUp()
    const good = (await lastEmail('verify-email', 'sari@example.com'))!.payload.code
    const wrong = good === '000000' ? '111111' : '000000'
    const ip = nextIp() // one browser: both attempts from the same address
    expect((await otp({ email: 'sari@example.com', otp: wrong }, ip)).status).toBe(400)
    expect((await otp({ email: 'sari@example.com', otp: good }, ip)).status).toBe(200)
    expect(await verified()).toBe(true)
  })

  it('an expired code is refused', async () => {
    await signUp()
    const good = (await lastEmail('verify-email', 'sari@example.com'))!.payload.code
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 11 * 60 * 1000 })
    try {
      expect((await otp({ email: 'sari@example.com', otp: good })).status).toBe(400)
    } finally {
      vi.useRealTimers()
    }
    expect(await verified()).toBe(false)
  })

  it('sign-in while unverified is refused and queues a fresh code', async () => {
    await signUp()
    const before = await prisma.emailOutbox.count({ where: { template: 'verify-email', to: 'sari@example.com' } })
    const res = await request('/api/auth/sign-in/email', { body: { email: 'sari@example.com', password: PASSWORD } })
    expect(res.status).toBe(403)
    expect(cookieFrom(res)).toBe('')
    expect(await prisma.emailOutbox.count({ where: { template: 'verify-email', to: 'sari@example.com' } })).toBe(before + 1)
    expect((await verifyEmailWithCode('sari@example.com')).status).toBe(200)
  })

  it('send-verification-otp accepts only type email-verification', async () => {
    await signUp()
    for (const type of ['sign-in', 'forget-password', 'change-email']) {
      const res = await request('/api/auth/email-otp/send-verification-otp', { body: { email: 'sari@example.com', type } })
      expect(res.status, type).toBe(400)
    }
    const ok = await request('/api/auth/email-otp/send-verification-otp', { body: { email: 'sari@example.com', type: 'email-verification' } })
    expect(ok.status).toBe(200)
    expect(await prisma.emailOutbox.count({ where: { template: 'verify-email', to: 'sari@example.com' } })).toBe(2)
  })

  it('a verified account is never sent a code, and unknown addresses get none', async () => {
    await registerAndSignIn('sari@example.com')
    const before = await prisma.emailOutbox.count({ where: { template: 'verify-email' } })
    for (const email of ['sari@example.com', 'ghost@example.com']) {
      const ok = await request('/api/auth/email-otp/send-verification-otp', { body: { email, type: 'email-verification' } })
      expect(ok.status).toBe(200)
    }
    expect(await prisma.emailOutbox.count({ where: { template: 'verify-email' } })).toBe(before)
  })

  it.each([
    '/api/auth/sign-in/email-otp',
    '/api/auth/forget-password/email-otp',
    '/api/auth/email-otp/request-password-reset',
    '/api/auth/email-otp/reset-password',
    '/api/auth/email-otp/request-email-change',
    '/api/auth/email-otp/change-email',
    '/api/auth/email-otp/check-verification-otp',
  ])('%s is refused with 404 and creates nothing', async (path) => {
    const res = await request(path, { body: { email: 'new@example.com', otp: '123456', type: 'sign-in', newEmail: 'x@example.com', password: PASSWORD } })
    expect(res.status).toBe(404)
    expect(await prisma.user.count({ where: { email: 'new@example.com' } })).toBe(0)
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

  it('reads the client address from the configured ipAddressHeaders (AUTH_IP_HEADERS, Vercel -> Railway)', async () => {
    const xffAuth = createAuth({ prisma, baseURL, secret, ipAddressHeaders: ['x-forwarded-for'] })
    const send = (xff: string) =>
      xffAuth.handler(
        new Request(`${baseURL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { origin: baseURL, 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.250', 'x-forwarded-for': xff },
          body: JSON.stringify({ email: 'nobody@example.com', password: 'salah-salah-1' }),
        }),
      )
    for (let i = 0; i < 3; i++) await send('198.51.100.1')
    expect((await send('198.51.100.1')).status).toBe(429)
    // Same cf-connecting-ip, different X-Forwarded-For: a separate bucket, because only XFF is configured.
    expect((await send('198.51.100.2')).status).not.toBe(429)
  })

  it('with x-forwarded-for configured, each client gets its own /send-verification-email bucket', async () => {
    const xffAuth = createAuth({ prisma, baseURL, secret, ipAddressHeaders: ['x-forwarded-for'] })
    const resend = (xff: string) =>
      xffAuth.handler(
        new Request(`${baseURL}/api/auth/send-verification-email`, {
          method: 'POST',
          // No cf-connecting-ip at all, as behind Vercel -> Railway.
          headers: { origin: baseURL, 'content-type': 'application/json', 'x-forwarded-for': xff },
          body: JSON.stringify({ email: 'nobody@example.com' }),
        }),
      )
    const a = '198.51.100.21'
    const b = '198.51.100.22'
    for (let i = 0; i < 3; i++) expect((await resend(a)).status).not.toBe(429)
    expect((await resend(a)).status).toBe(429)
    // A different client is unaffected by a's exhausted bucket.
    for (let i = 0; i < 3; i++) expect((await resend(b)).status).not.toBe(429)
    expect((await resend(b)).status).toBe(429)
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
    expect(session?.user.email).toBe('ratna.hendrawan@kobo.test')
    expect(session?.user.isDemo).toBe(true)
    expect(session?.isOwner).toBe(true)
    expect(session?.ownerProfileId).toBeTruthy()
    expect(await prisma.session.count({ where: { userId: session!.user.id } })).toBe(1)
  })

  it('signs in the campus-verified demo student, who is not an owner', async () => {
    const session = await me(await demoCookie('student'))
    expect(session?.user.email).toBe('dimas.pratama@kobo.test')
    expect(session?.isOwner).toBe(false)
    expect(session?.ownerProfileId).toBeNull()
    expect(session?.campusVerified).toBe(true)
  })

  it('signs in the two pre-paired Teman Sekamar demo students', async () => {
    for (const [persona, email] of [
      ['temanA', 'nadia.putri@kobo.test'],
      ['temanB', 'clara.wijaya@kobo.test'],
    ] as const) {
      const session = await me(await demoCookie(persona))
      expect(session?.user.email).toBe(email)
      expect(session?.user.isDemo).toBe(true)
      expect(session?.isOwner).toBe(false)
      expect(session?.ownerProfileId).toBeNull()
      expect(session?.campusVerified).toBe(true)
    }
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
    const accounts = await prisma.account.count({ where: { user: { email: 'ratna.hendrawan@kobo.test' } } })
    expect(accounts).toBe(0) // still no way to sign in with a password
  })

  it('blocks email change, account deletion and campus-email changes for demo users', async () => {
    const cookie = await demoCookie('student')
    for (const [path, body] of [
      ['/api/auth/change-email', { newEmail: 'baru@example.com' }],
      ['/api/auth/delete-user', {}],
      ['/api/auth/campus-email/request', { email: 'x@binus.ac.id' }],
      ['/api/auth/campus-email/confirm', { code: '123456' }],
    ] as const) {
      const res = await request(path, { cookie, body })
      expect(res.status, path).toBe(403)
      expect(((await res.json()) as { code: string }).code, path).toBe('DEMO_ACCOUNT_READONLY')
    }
    expect(await prisma.user.count({ where: { email: 'dimas.pratama@kobo.test' } })).toBe(1)
  })

  it('blocks campus-account verification start for demo users', async () => {
    const cookie = await demoCookie('student')
    const res = await request('/api/auth/campus-idp/start?provider=google', { cookie })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('DEMO_ACCOUNT_READONLY')
  })

  it('does not email password-reset links for demo accounts', async () => {
    const res = await request('/api/auth/request-password-reset', { body: { email: 'ratna.hendrawan@kobo.test', redirectTo: '/' } })
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

describe('server-controlled verification fields', () => {
  it('/update-user cannot set campusVerifiedVia, campusVerifiedUntil or the campus-account identity', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    const res = await request('/api/auth/update-user', {
      cookie,
      body: { name: 'Sari', campusVerifiedVia: 'KTM', campusVerifiedUntil: new Date(Date.now() + 86_400_000).toISOString(), campusIdpTenant: 'x', campusIdpSubject: 'y' },
    })
    expect(res.status).toBeLessThan(500)
    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'sari@example.com' } })
    expect([row.campusVerifiedVia, row.campusVerifiedUntil, row.campusIdpTenant, row.campusIdpSubject]).toEqual([null, null, null, null])
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
