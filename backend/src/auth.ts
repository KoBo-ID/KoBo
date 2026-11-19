import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx, sessionMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { emailOTP } from 'better-auth/plugins'
import type { BetterAuthPlugin } from 'better-auth'
import { STUDENT_VERIFICATION_MAX_DAYS, TERMS_VERSION } from '@kobo/shared/domain'
import { campusEmailCodeInput, profileCampusField, profilePhoneField, profileUpdateInput } from '@kobo/shared/schemas'
import { z } from 'zod'
import {
  CAMPUS_CHALLENGE_TTL_SECONDS,
  CAMPUS_CODE_MAX_ATTEMPTS,
  campusForDomain,
  codeMatches,
  defaultMxResolver,
  emailDomain,
  generateCampusCode,
  hashCampusCode,
  type CampusMxResolver,
} from './campusEmail.ts'
import { CampusIdpError, createCampusIdp, type CampusIdp, type CampusIdpProvider, type IdClaims } from './campusIdp.ts'
import type { PrismaClient } from './db/client.ts'
import { DEMO_EMAILS } from './demo.ts'
import { enqueueEmail } from './outbox.ts'
import { applyVerification } from './studentVerification/verifier.ts'

/*
 * better-auth wiring (spec section 5).
 *  - Prisma adapter against the existing User/Session/Account/Verification models.
 *  - Email + password with mandatory verification. Mails are queued in EmailOutbox, never sent inline.
 *  - Built-in rate limiter, memory storage (one container). It is on in every environment, including tests.
 *  - The client address header is deployment-specific (AUTH_IP_HEADERS, via authEnv()). The production default is
 *    cf-connecting-ip only, for the Cloudflare-tunnel deployment where the origin is unreachable otherwise. Behind
 *    Vercel -> Railway there is no Cloudflare, so set AUTH_IP_HEADERS=x-forwarded-for (Vercel overwrites it with the
 *    real client IP); without a resolvable IP every client shares one rate-limit bucket per path.
 *  - One KoBo plugin: demo login, campus-email verification (code only) and campus-account OIDC verification,
 *    so all sit behind the same limiter.
 */

export interface AuthOptions {
  prisma: PrismaClient
  /** Public origin, e.g. https://kobo.example. Secure cookies follow its scheme. */
  baseURL: string
  secret: string
  /** Extra origins allowed to call the API with cookies (the Vite dev server). */
  trustedOrigins?: string[]
  /** Headers the client IP is read from, in order. Defaults to defaultIpHeaders() for the current NODE_ENV. */
  ipAddressHeaders?: string[]
  /** Google sign-in. Omitted: the provider is not registered at all. Built by googleEnv(). */
  google?: { clientId: string; clientSecret: string }
  /** Microsoft campus-account verification (its own Entra app). Built by campusMsEnv(). Google campus verification reuses `google`. */
  campusMs?: { clientId: string; clientSecret: string }
  /** Which campus-account providers are usable. Default: derived from `campusMs` / `google`. Built by authEnv(). */
  campusIdpProviders?: { microsoft: boolean; google: boolean }
  /** Campus IdP transport. Default: the real Microsoft/Google OIDC client. Tests inject a local-JWKS one. */
  campusIdp?: CampusIdp
  /** MX check for campus-email domains. Default: real DNS (a fake that accepts everything under NODE_ENV=test / ALLOW_E2E_HOOKS=1). */
  campusMx?: CampusMxResolver
}

/** Person-name limit, the same 80 as profileUpdateInput. */
const MAX_NAME = 80

/** Production trusts only Cloudflare's header. X-Forwarded-For is client-controlled unless a proxy overwrites it, so by default it is accepted in dev only. */
const defaultIpHeaders = () => (process.env.NODE_ENV === 'production' ? ['cf-connecting-ip'] : ['cf-connecting-ip', 'x-forwarded-for'])

/** Paths a demo account may never use. Session-based; checked against the caller's user. */
const DEMO_BLOCKED_PATHS = new Set([
  '/change-password',
  '/set-password',
  '/change-email',
  '/delete-user',
  '/campus-email/request',
  '/campus-email/confirm',
  '/campus-idp/start',
  '/link-social',
  '/unlink-account',
])
/** Paths that act on an account identified by an email in the body rather than by session. */
const DEMO_BLOCKED_BY_EMAIL = new Set(['/request-password-reset', '/send-verification-email', '/email-otp/send-verification-otp'])

/** The only emailOTP routes that stay reachable: everything else (sign-in, password reset, email change, create/get/check) is refused. */
const OTP_ALLOWED_PATHS = new Set(['/email-otp/send-verification-otp', '/email-otp/verify-email'])
const isOtpPath = (path: string) => path.startsWith('/email-otp/') || path === '/sign-in/email-otp' || path === '/forget-password/email-otp'

const demoForbidden = () =>
  new APIError('FORBIDDEN', { message: 'Akun ini bersifat hanya-baca: kata sandi, email, dan penghapusan akun tidak dapat diubah.', code: 'DEMO_ACCOUNT_READONLY' })

/** Sign-up carries phone and campus too: apply the same field schemas as profileUpdateInput. Returns an error message, or null. */
function checkSignUpExtras(d: { phone?: unknown; campus?: unknown } | undefined): string | null {
  if (!d) return null
  const given = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '') // the form sends '' for an empty optional field
  if (given(d.phone) && !profilePhoneField.safeParse(d.phone).success) return 'Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890.'
  if (given(d.campus) && !profileCampusField.safeParse(d.campus).success) return 'Nama kampus terlalu panjang (maksimal 80 karakter).'
  return null
}

const invalidCampusEmail = () => new APIError('BAD_REQUEST', { message: 'Masukkan alamat email kampus yang valid.', code: 'INVALID_CAMPUS_EMAIL' })

const MSG_DOMAIN_UNKNOWN = 'Domain email ini belum terdaftar sebagai email mahasiswa. Coba verifikasi dengan akun kampus atau unggah KTM.'
const MSG_CODE_DEAD = 'Kode sudah kedaluwarsa atau terlalu banyak salah. Minta kode baru.'

/** Upper bound on the campus catalogue scanned to map an email domain / IdP tenant (the nationwide catalogue is a few thousand rows). */
const CAMPUS_SCAN_CAP = 10_000

class ChallengeGone extends Error {}

const IDP_COOKIE = 'kobo_campus_idp'
const IDP_FLOW_TTL_MS = 10 * 60 * 1000

/** Every successful method (email, Microsoft, Google) verifies for 365 days. */
const verificationUntil = (now: Date) => new Date(now.getTime() + STUDENT_VERIFICATION_MAX_DAYS * 86_400_000)

/** The flow cookie lives only under the campus-idp path, so it is never sent with any other request. */
function idpCookieOptions(baseURL: string, maxAgeSeconds: number) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: baseURL.startsWith('https:'), path: `${new URL(baseURL).pathname.replace(/\/+$/, '')}/campus-idp`, maxAge: maxAgeSeconds }
}

interface PluginDeps {
  mx: CampusMxResolver
  idp: CampusIdp
  idpProviders: { microsoft: boolean; google: boolean }
}

function koboPlugin(prisma: PrismaClient, secret: string, { mx, idp, idpProviders }: PluginDeps): BetterAuthPlugin {
  // The flow cookie is stateless, so a captured copy could be replayed. States already used are remembered until they would
  // have expired anyway (one container, like the memory rate limiter); the IdP's own one-time code is the second line.
  const usedStates = new Map<string, number>()
  const useState = (state: string): boolean => {
    const now = Date.now()
    for (const [k, exp] of usedStates) if (exp < now) usedStates.delete(k)
    if (usedStates.has(state)) return false
    usedStates.set(state, now + IDP_FLOW_TTL_MS)
    return true
  }

  /**
   * Consume a challenge and verify its owner in ONE transaction. The challenge must belong to the caller. False when it
   * is dead, replayed, or the mailbox already belongs to another account.
   */
  async function consumeChallenge(challengeId: string, userId: string): Promise<boolean> {
    const now = new Date()
    const challenge = await prisma.campusEmailChallenge.findUnique({ where: { id: challengeId } })
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now || challenge.userId !== userId) return false
    const taken = await prisma.user.findFirst({ where: { campusEmail: challenge.email, campusEmailVerifiedAt: { not: null }, id: { not: challenge.userId } }, select: { id: true } })
    if (taken) return false
    const campuses = await prisma.campus.findMany({ select: { shortName: true, studentEmailDomains: true }, take: CAMPUS_SCAN_CAP })
    const campus = campusForDomain(emailDomain(challenge.email) ?? '', campuses)
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.campusEmailChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } })
        if (claimed.count !== 1) throw new ChallengeGone()
        await tx.user.update({ where: { id: challenge.userId }, data: { campusEmail: challenge.email } })
        await applyVerification(tx, challenge.userId, { via: 'EMAIL', until: verificationUntil(now), campusShortName: campus?.shortName }, now)
      })
    } catch (e) {
      // Two accounts verified the same mailbox at once: the partial unique index lets exactly one win.
      if (e instanceof ChallengeGone || (e as { code?: string } | null)?.code === 'P2002') return false
      throw e
    }
    return true
  }

  return {
    id: 'kobo',
    endpoints: {
      /**
       * One-click demo sign-in. The seeded demo users have no credential account, so there is no password to
       * leak or guess. We mint a real session row and cookie for the fixed demo user directly.
       */
      demoLogin: createAuthEndpoint('/demo-login', { method: 'POST', body: z.object({ as: z.enum(['student', 'owner']) }) }, async (ctx) => {
        const found = await ctx.context.internalAdapter.findUserByEmail(DEMO_EMAILS[ctx.body.as])
        const user = found?.user
        if (!user || !(user as { isDemo?: boolean }).isDemo) throw new APIError('NOT_FOUND', { message: 'Masuk cepat belum tersedia.', code: 'DEMO_NOT_SEEDED' })
        const session = await ctx.context.internalAdapter.createSession(user.id)
        await setSessionCookie(ctx, { session, user })
        return ctx.json({ ok: true })
      }),

      /**
       * Submit a campus email. The domain must be on a campus's curated student list (exact match) and accept mail (MX).
       * Creates a CampusEmailChallenge and emails a 6-digit code (no link: mail scanners open links), valid 10 minutes. Rate limited via customRules.
       */
      requestCampusEmail: createAuthEndpoint(
        '/campus-email/request',
        { method: 'POST', body: z.object({ email: z.string().max(254) }), use: [sessionMiddleware] },
        async (ctx) => {
          const email = ctx.body.email.trim().toLowerCase()
          const domain = emailDomain(email)
          if (!z.email().safeParse(email).success || !domain) throw invalidCampusEmail()
          const campuses = await prisma.campus.findMany({ select: { shortName: true, studentEmailDomains: true }, take: CAMPUS_SCAN_CAP })
          if (!campusForDomain(domain, campuses)) throw new APIError('BAD_REQUEST', { message: MSG_DOMAIN_UNKNOWN, code: 'CAMPUS_EMAIL_DOMAIN_UNKNOWN' })
          if (!(await mx(domain))) throw new APIError('BAD_REQUEST', { message: 'Domain email ini tidak bisa menerima email.', code: 'CAMPUS_EMAIL_NO_MX' })

          const user = ctx.context.session.user
          const taken = await prisma.user.findFirst({ where: { campusEmail: email, campusEmailVerifiedAt: { not: null }, id: { not: user.id } }, select: { id: true } })
          if (taken) throw new APIError('CONFLICT', { message: 'Email kampus ini sudah dipakai akun lain.', code: 'CAMPUS_EMAIL_TAKEN' })

          const now = new Date()
          const code = generateCampusCode()
          const id = randomUUID()
          await prisma.$transaction(async (tx) => {
            // Serialize concurrent requests of one user, so exactly one challenge stays live.
            await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`
            // Only the newest challenge is live: an older mail's code stops working.
            await tx.campusEmailChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } })
            await tx.campusEmailChallenge.create({
              data: { id, userId: user.id, email, codeHash: hashCampusCode(secret, id, code), expiresAt: new Date(now.getTime() + CAMPUS_CHALLENGE_TTL_SECONDS * 1000) },
            })
            // Same transaction: a rolled-back challenge never has a mail, a mail never exists without its challenge.
            await enqueueEmail(tx, { to: email, template: 'campus-email', payload: { name: user.name, code } })
          })
          return ctx.json({ ok: true })
        },
      ),

      /** Confirm with the 6-digit code. Needs a session; checks the caller's newest live challenge; 5 wrong codes kill it. */
      confirmCampusEmail: createAuthEndpoint('/campus-email/confirm', { method: 'POST', body: campusEmailCodeInput, use: [sessionMiddleware] }, async (ctx) => {
        const userId = ctx.context.session.user.id
        const now = new Date()
        const live = { consumedAt: null, expiresAt: { gt: now }, attempts: { lt: CAMPUS_CODE_MAX_ATTEMPTS } }
        const challenge = await prisma.campusEmailChallenge.findFirst({ where: { userId, ...live }, orderBy: { createdAt: 'desc' } })
        if (!challenge) throw new APIError('BAD_REQUEST', { message: MSG_CODE_DEAD, code: 'CAMPUS_CODE_EXPIRED' })
        // Count the attempt atomically BEFORE comparing, so parallel guesses cannot exceed the limit.
        const counted = await prisma.campusEmailChallenge.updateMany({ where: { id: challenge.id, ...live }, data: { attempts: { increment: 1 } } })
        if (counted.count !== 1) throw new APIError('BAD_REQUEST', { message: MSG_CODE_DEAD, code: 'CAMPUS_CODE_EXPIRED' })
        if (!codeMatches(secret, challenge.id, ctx.body.code, challenge.codeHash)) {
          throw new APIError('BAD_REQUEST', { message: 'Kode salah. Periksa kembali kode di email Anda.', code: 'CAMPUS_CODE_INVALID' })
        }
        const ok = await consumeChallenge(challenge.id, userId)
        if (!ok) throw new APIError('CONFLICT', { message: 'Email kampus ini sudah dipakai akun lain.', code: 'CAMPUS_EMAIL_TAKEN' })
        return ctx.json({ ok: true })
      }),

      /** Begin campus-account verification: PKCE + state + nonce in a signed cookie scoped to this path, then redirect to the IdP. */
      campusIdpStart: createAuthEndpoint(
        '/campus-idp/start',
        { method: 'GET', query: z.object({ provider: z.enum(['microsoft', 'google']) }), use: [sessionMiddleware] },
        async (ctx) => {
          const provider = ctx.query.provider
          if (!idpProviders[provider]) throw ctx.redirect('/profile?campus=idp-unavailable')
          const state = randomBytes(24).toString('base64url')
          const nonce = randomBytes(24).toString('base64url')
          const codeVerifier = randomBytes(48).toString('base64url')
          const value = JSON.stringify({ s: state, n: nonce, v: codeVerifier, u: ctx.context.session.user.id, p: provider, x: Date.now() + IDP_FLOW_TTL_MS })
          await ctx.setSignedCookie(IDP_COOKIE, value, secret, idpCookieOptions(ctx.context.baseURL, IDP_FLOW_TTL_MS / 1000))
          const url = await idp.authorizationUrl({ provider, state, nonce, codeVerifier, redirectUri: `${ctx.context.baseURL}/campus-idp/callback` })
          throw ctx.redirect(url)
        },
      ),

      /** IdP redirect target. Maps the verified tenant (tid) or Workspace domain (hd) to a campus; never creates an Account. */
      campusIdpCallback: createAuthEndpoint(
        '/campus-idp/callback',
        { method: 'GET', query: z.object({ code: z.string().max(4096).optional(), state: z.string().max(512).optional(), error: z.string().max(200).optional() }) },
        async (ctx) => {
          const raw = await ctx.getSignedCookie(IDP_COOKIE, secret)
          // One shot: the flow cookie is cleared on every callback, so a replayed or retried callback finds nothing.
          ctx.setCookie(IDP_COOKIE, '', idpCookieOptions(ctx.context.baseURL, 0))
          const session = await getSessionFromCtx(ctx)
          let flow: { s: string; n: string; v: string; u: string; p: CampusIdpProvider; x: number } | null = null
          try {
            flow = typeof raw === 'string' ? JSON.parse(raw) : null
          } catch {
            flow = null
          }
          const stateOk = !!flow && typeof ctx.query.state === 'string' && ctx.query.state.length === flow.s.length && timingSafeEqual(Buffer.from(ctx.query.state), Buffer.from(flow.s))
          if (!flow || !stateOk || flow.x < Date.now() || !session || session.user.id !== flow.u || (flow.p !== 'microsoft' && flow.p !== 'google') || !idpProviders[flow.p]) {
            throw ctx.redirect('/profile?campus=idp-invalid')
          }
          if (!useState(flow.s)) throw ctx.redirect('/profile?campus=idp-invalid')
          if (ctx.query.error || !ctx.query.code) throw ctx.redirect('/profile?campus=idp-cancelled')

          let claims: IdClaims
          try {
            const redirectUri = `${ctx.context.baseURL}/campus-idp/callback`
            const { idToken } = await idp.exchange({ provider: flow.p, code: ctx.query.code, codeVerifier: flow.v, redirectUri })
            claims = await idp.verifyIdToken({ provider: flow.p, idToken, nonce: flow.n })
          } catch (e) {
            console.warn('[campus-idp] verification failed', { provider: flow.p, reason: e instanceof CampusIdpError ? e.reason : 'error' })
            throw ctx.redirect('/profile?campus=idp-invalid')
          }

          const campuses = await prisma.campus.findMany({ select: { shortName: true, entraTenantIds: true, studentEmailDomains: true }, take: CAMPUS_SCAN_CAP })
          const campus =
            claims.provider === 'microsoft'
              ? campuses.find((c) => c.entraTenantIds.some((t) => t.toLowerCase() === claims.tid))
              : campuses.find((c) => c.studentEmailDomains.some((d) => d.toLowerCase() === claims.hd))
          if (!campus) {
            console.warn('[campus-idp] unknown', claims.provider === 'microsoft' ? { provider: 'microsoft', tid: claims.tid } : { provider: 'google', hd: claims.hd })
            throw ctx.redirect('/profile?campus=idp-unknown')
          }

          const tenant = claims.provider === 'microsoft' ? claims.tid : `google:${claims.hd}`
          const subject = claims.provider === 'microsoft' ? claims.oid : claims.sub
          const userId = session.user.id
          const taken = await prisma.user.findFirst({ where: { campusIdpTenant: tenant, campusIdpSubject: subject, id: { not: userId } }, select: { id: true } })
          if (taken) throw ctx.redirect('/profile?campus=idp-taken')
          const now = new Date()
          try {
            await prisma.$transaction(async (tx) => {
              const via = claims.provider === 'microsoft' ? 'MICROSOFT' : 'GOOGLE'
              await applyVerification(tx, userId, { via, until: verificationUntil(now), campusShortName: campus.shortName }, now)
              // The IdP identity is recorded only when this verification actually took effect; a longer-lived verification by
              // another method (applyVerification keeps it) must not be left pointing at an identity that did not win.
              const after = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { campusVerifiedVia: true } })
              if (after.campusVerifiedVia === via) await tx.user.update({ where: { id: userId }, data: { campusIdpTenant: tenant, campusIdpSubject: subject } })
            })
          } catch (e) {
            if ((e as { code?: string } | null)?.code === 'P2002') throw ctx.redirect('/profile?campus=idp-taken')
            throw e
          }
          throw ctx.redirect('/profile?campus=verified')
        },
      ),
    },
  }
}

export function createAuth({ prisma, baseURL, secret, trustedOrigins = [], ipAddressHeaders = defaultIpHeaders(), google, campusMs, campusIdpProviders, campusIdp, campusMx }: AuthOptions) {
  const idpProviders = campusIdpProviders ?? { microsoft: !!campusMs, google: !!google }
  const auth = betterAuth({
    baseURL,
    secret,
    trustedOrigins,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      // Better Auth leaves other sessions alive after a reset by default; a reset usually means the old password or a session leaked.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await enqueueEmail(prisma, { to: user.email, template: 'reset-password', payload: { name: user.name, url } })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      // Unverified sign-in attempts get a fresh code. No sendVerificationEmail here on purpose: the emailOTP plugin
      // (overrideDefaultEmailVerification) installs the code sender, so no link mail can ever exist.
      sendOnSignIn: true,
    },

    user: {
      additionalFields: {
        phone: { type: 'string', required: false },
        campus: { type: 'string', required: false },
        // Server-controlled: never accepted from a client.
        campusEmail: { type: 'string', required: false, input: false },
        campusEmailVerifiedAt: { type: 'date', required: false, input: false },
        campusVerifiedVia: { type: 'string', required: false, input: false },
        campusVerifiedUntil: { type: 'date', required: false, input: false },
        campusIdpTenant: { type: 'string', required: false, input: false },
        campusIdpSubject: { type: 'string', required: false, input: false },
        isDemo: { type: 'boolean', required: false, defaultValue: false, input: false },
        // Sent by the sign-up form; the create hook keeps it only when it is the current Syarat version, and stamps the time.
        termsVersion: { type: 'string', required: false },
        termsAcceptedAt: { type: 'date', required: false, input: false },
      },
    },

    // Google verifies the address, so a student who first registered with email + password is linked, not duplicated.
    // better-auth >= 1.6.11 (requireLocalEmailVerified defaults to true) refuses to link into a local account whose email
    // is still unverified (GHSA-g38m-r43w-p2q7), so a squatted unverified signup cannot absorb a victim's Google login.
    // Linking never touches campusEmail: student verification stays its own explicit step.
    ...(google ? { socialProviders: { google: { clientId: google.clientId, clientSecret: google.clientSecret, prompt: 'select_account' as const } } } : {}),
    account: { accountLinking: { enabled: true, trustedProviders: ['google'], requireLocalEmailVerified: true } },

    advanced: {
      ipAddress: { ipAddressHeaders },
      // better-auth turns the Origin/Referer check off when NODE_ENV=test unless this is set explicitly. Pinning it to false
      // keeps the check identical in every environment, so vitest can test it. Requests with neither header are still accepted.
      disableOriginCheck: false,
    },

    rateLimit: {
      enabled: true, // better-auth defaults to production only; tests exercise it too.
      storage: 'memory',
      customRules: {
        // Sign-in / sign-up keep better-auth's built-in 3 per 10 s. These stop email-bombing through our domain.
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
        '/email-otp/verify-email': { window: 60, max: 10 },
        '/campus-email/request': { window: 60, max: 3 },
        '/campus-email/confirm': { window: 60, max: 10 },
        '/campus-idp/start': { window: 60, max: 10 },
        '/campus-idp/callback': { window: 60, max: 10 },
        '/demo-login': { window: 60, max: 60 },
      },
    },

    databaseHooks: {
      user: {
        update: {
          // Better Auth's own /update-user accepts any string for the additional fields, bypassing the tRPC profile schema.
          // Apply the same limits (name, WhatsApp number, campus) to every write.
          before: async (data) => {
            const d = data as { name?: unknown; phone?: unknown; campus?: unknown }
            const checked = profileUpdateInput.partial().safeParse({
              ...(d.name !== undefined ? { name: d.name } : {}),
              ...(d.phone !== undefined ? { phone: d.phone } : {}),
              ...(d.campus !== undefined ? { campus: d.campus } : {}),
            })
            if (!checked.success) throw new APIError('BAD_REQUEST', { message: checked.error.issues[0]?.message ?? 'Data profil tidak valid.', code: 'INVALID_PROFILE' })
            // The terms version is recorded only through sign-up and auth.acceptTerms (both check it), never by a raw update.
            const { termsVersion: _tv, termsAcceptedAt: _ta, ...rest } = data as Record<string, unknown>
            return { data: { ...rest, ...checked.data } }
          },
        },
        create: {
          // A Google sign-up would otherwise copy the Google photo. Every new account starts with KoBo's default avatar
          // (the initial on the brand tint, rendered by the frontend when `image` is empty); a photo is the user's own choice later.
          before: async (user) => {
            const extras = checkSignUpExtras(user as { phone?: unknown; campus?: unknown })
            if (extras) throw new APIError('BAD_REQUEST', { message: extras, code: 'INVALID_PROFILE' })
            const claimed = (user as { termsVersion?: unknown }).termsVersion
            const accepted = claimed === TERMS_VERSION
            // Backstop for every creation path: the sign-up endpoint hook refuses a long name; a Google display name is clamped, never blocking.
            const name = typeof user.name === 'string' ? user.name.slice(0, MAX_NAME) : user.name
            return { data: { ...user, name, image: null, termsVersion: accepted ? TERMS_VERSION : null, termsAcceptedAt: accepted ? new Date() : null } }
          },
        },
      },
      account: {
        create: {
          // Implicit linking at the OAuth callback bypasses the path guards above, so refuse the insert itself for a demo user.
          before: async (account) => {
            const target = await prisma.user.findUnique({ where: { id: account.userId }, select: { isDemo: true } })
            if (target?.isDemo) throw demoForbidden()
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-up/email') {
          const body = ctx.body as { name?: unknown; phone?: unknown; campus?: unknown } | undefined
          const extras = checkSignUpExtras(body)
          if (extras) throw new APIError('BAD_REQUEST', { message: extras, code: 'INVALID_PROFILE' })
          const name = body?.name
          if (typeof name === 'string' && !profileUpdateInput.shape.name.safeParse(name).success && name.trim().length > 0) {
            throw new APIError('BAD_REQUEST', { message: 'Nama terlalu panjang (maksimal 80 karakter).', code: 'INVALID_PROFILE' })
          }
        }
        if (isOtpPath(ctx.path)) {
          if (!OTP_ALLOWED_PATHS.has(ctx.path)) throw new APIError('NOT_FOUND', { message: 'Tidak ditemukan.', code: 'NOT_FOUND' })
          if (ctx.path === '/email-otp/send-verification-otp' && (ctx.body as { type?: unknown } | undefined)?.type !== 'email-verification') {
            throw new APIError('BAD_REQUEST', { message: 'Jenis kode tidak valid.', code: 'INVALID_OTP_TYPE' })
          }
        }
        if (DEMO_BLOCKED_PATHS.has(ctx.path)) {
          const session = await getSessionFromCtx(ctx)
          if ((session?.user as { isDemo?: boolean } | undefined)?.isDemo) throw demoForbidden()
        }
        if (DEMO_BLOCKED_BY_EMAIL.has(ctx.path)) {
          const email = (ctx.body as { email?: unknown } | undefined)?.email
          if (typeof email === 'string') {
            const found = await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase())
            if ((found?.user as { isDemo?: boolean } | undefined)?.isDemo) throw demoForbidden()
          }
        }
      }),
    },

    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        overrideDefaultEmailVerification: true,
        disableSignUp: true,
        rateLimit: { window: 60, max: 5 },
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== 'email-verification') return
          const user = await prisma.user.findUnique({ where: { email }, select: { name: true, emailVerified: true } })
          // A verified account never gets a code: verify-email would otherwise act as a passwordless sign-in.
          if (!user || user.emailVerified) return
          await enqueueEmail(prisma, { to: email, template: 'verify-email', payload: { name: user.name, code: otp } })
        },
      }),
      koboPlugin(prisma, secret, { mx: campusMx ?? defaultMxResolver(), idp: campusIdp ?? createCampusIdp({ microsoft: campusMs, google }), idpProviders }),
    ],
  })
  // tRPC reports which campus-account providers exist (auth.me / studentVerification.status) without ever seeing credentials.
  return Object.assign(auth, { campusIdpProviders: idpProviders })
}

export type Auth = ReturnType<typeof createAuth>
