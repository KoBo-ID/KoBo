import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx, sessionMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import type { BetterAuthPlugin } from 'better-auth'
import { TERMS_VERSION } from '@kobo/shared/domain'
import { profileUpdateInput } from '@kobo/shared/schemas'
import { z } from 'zod'
import { CAMPUS_TOKEN_TTL_SECONDS, domainMatches, emailDomain, isAcademicDomain, signCampusToken, verifyCampusToken } from './campusEmail.ts'
import type { PrismaClient } from './db/client.ts'
import { DEMO_EMAILS } from './demo.ts'
import { enqueueEmail } from './outbox.ts'

/*
 * better-auth wiring (spec section 5).
 *  - Prisma adapter against the existing User/Session/Account/Verification models.
 *  - Email + password with mandatory verification. Mails are queued in EmailOutbox, never sent inline.
 *  - Built-in rate limiter, memory storage (one container). It is on in every environment, including tests.
 *  - The client address header is deployment-specific (AUTH_IP_HEADERS, via authEnv()). The production default is
 *    cf-connecting-ip only, for the Cloudflare-tunnel deployment where the origin is unreachable otherwise. Behind
 *    Vercel -> Railway there is no Cloudflare, so set AUTH_IP_HEADERS=x-forwarded-for (Vercel overwrites it with the
 *    real client IP); without a resolvable IP every client shares one rate-limit bucket per path.
 *  - One KoBo plugin: demo login and campus-email verification, so both sit behind the same limiter.
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
}

/** Person-name limit, the same 80 as profileUpdateInput. */
const MAX_NAME = 80

/** Production trusts only Cloudflare's header. X-Forwarded-For is client-controlled unless a proxy overwrites it, so by default it is accepted in dev only. */
const defaultIpHeaders = () => (process.env.NODE_ENV === 'production' ? ['cf-connecting-ip'] : ['cf-connecting-ip', 'x-forwarded-for'])

/** Paths a demo account may never use. Session-based; checked against the caller's user. */
const DEMO_BLOCKED_PATHS = new Set(['/change-password', '/set-password', '/change-email', '/delete-user', '/campus-email/request', '/link-social', '/unlink-account'])
/** Paths that act on an account identified by an email in the body rather than by session. */
const DEMO_BLOCKED_BY_EMAIL = new Set(['/request-password-reset', '/send-verification-email'])

const demoForbidden = () =>
  new APIError('FORBIDDEN', { message: 'Akun ini bersifat hanya-baca: kata sandi, email, dan penghapusan akun tidak dapat diubah.', code: 'DEMO_ACCOUNT_READONLY' })

const invalidCampusEmail = () =>
  new APIError('BAD_REQUEST', { message: 'Gunakan email kampus yang berakhiran .ac.id.', code: 'INVALID_CAMPUS_EMAIL' })

function koboPlugin(prisma: PrismaClient, secret: string): BetterAuthPlugin {
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

      /** Submit a campus email. Emails a signed link, valid 24 h. Rate limited via customRules. */
      requestCampusEmail: createAuthEndpoint(
        '/campus-email/request',
        { method: 'POST', body: z.object({ email: z.string().max(254) }), use: [sessionMiddleware] },
        async (ctx) => {
          const email = ctx.body.email.trim().toLowerCase()
          const domain = emailDomain(email)
          if (!z.email().safeParse(email).success || !domain || !isAcademicDomain(domain)) throw invalidCampusEmail()

          const user = ctx.context.session.user
          const taken = await prisma.user.findFirst({ where: { campusEmail: email, campusEmailVerifiedAt: { not: null }, id: { not: user.id } }, select: { id: true } })
          if (taken) throw new APIError('CONFLICT', { message: 'Email kampus ini sudah dipakai akun lain.', code: 'CAMPUS_EMAIL_TAKEN' })

          const token = signCampusToken(secret, { userId: user.id, email }, CAMPUS_TOKEN_TTL_SECONDS)
          const url = `${ctx.context.baseURL}/campus-email/verify?token=${encodeURIComponent(token)}`
          await enqueueEmail(prisma, { to: email, template: 'campus-email', payload: { name: user.name, url } })
          return ctx.json({ ok: true })
        },
      ),

      /** Landing page for the emailed link. Possession of the mailbox is the proof, so no session is required. */
      verifyCampusEmail: createAuthEndpoint('/campus-email/verify', { method: 'GET', query: z.object({ token: z.string() }) }, async (ctx) => {
        const claim = verifyCampusToken(secret, ctx.query.token)
        const user = claim ? await prisma.user.findUnique({ where: { id: claim.userId }, select: { id: true, campus: true } }) : null
        if (!claim || !user) throw ctx.redirect('/profile?campus=invalid')

        const taken = await prisma.user.findFirst({ where: { campusEmail: claim.email, campusEmailVerifiedAt: { not: null }, id: { not: user.id } }, select: { id: true } })
        if (taken) throw ctx.redirect('/profile?campus=invalid')

        const domain = emailDomain(claim.email) ?? ''
        const campuses = await prisma.campus.findMany({ select: { shortName: true, emailDomains: true } })
        const campus = campuses.find((c) => c.emailDomains.some((d) => domainMatches(domain, d)))
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { campusEmail: claim.email, campusEmailVerifiedAt: new Date(), ...(campus && !user.campus ? { campus: campus.shortName } : {}) },
          })
        } catch (e) {
          // Two accounts verified the same mailbox at once: the partial unique index lets exactly one win.
          if ((e as { code?: string } | null)?.code === 'P2002') throw ctx.redirect('/profile?campus=invalid')
          throw e
        }
        throw ctx.redirect('/profile?campus=verified')
      }),
    },
  }
}

export function createAuth({ prisma, baseURL, secret, trustedOrigins = [], ipAddressHeaders = defaultIpHeaders(), google }: AuthOptions) {
  return betterAuth({
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
      sendVerificationEmail: async ({ user, url }) => {
        await enqueueEmail(prisma, { to: user.email, template: 'verify-email', payload: { name: user.name, url } })
      },
    },

    user: {
      additionalFields: {
        phone: { type: 'string', required: false },
        campus: { type: 'string', required: false },
        // Server-controlled: never accepted from a client.
        campusEmail: { type: 'string', required: false, input: false },
        campusEmailVerifiedAt: { type: 'date', required: false, input: false },
        isDemo: { type: 'boolean', required: false, defaultValue: false, input: false },
        // Sent by the sign-up form; the create hook keeps it only when it is the current Syarat version, and stamps the time.
        termsVersion: { type: 'string', required: false },
        termsAcceptedAt: { type: 'date', required: false, input: false },
      },
    },

    // Google verifies the address, so a student who first registered with email + password is linked, not duplicated.
    // better-auth >= 1.6.11 (requireLocalEmailVerified defaults to true) refuses to link into a local account whose email
    // is still unverified (GHSA-g38m-r43w-p2q7), so a squatted unverified signup cannot absorb a victim's Google login.
    // Linking never touches campusEmail: the .ac.id discount stays its own explicit step.
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
        '/campus-email/request': { window: 60, max: 3 },
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
          const name = (ctx.body as { name?: unknown } | undefined)?.name
          if (typeof name === 'string' && !profileUpdateInput.shape.name.safeParse(name).success && name.trim().length > 0) {
            throw new APIError('BAD_REQUEST', { message: 'Nama terlalu panjang (maksimal 80 karakter).', code: 'INVALID_PROFILE' })
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

    plugins: [koboPlugin(prisma, secret)],
  })
}

export type Auth = ReturnType<typeof createAuth>
