import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx, sessionMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import type { BetterAuthPlugin } from 'better-auth'
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
 *  - The client address is read ONLY from cf-connecting-ip; X-Forwarded-For is client-controlled and would let
 *    anyone reset their own limit. Safe because the origin is reachable only through the Cloudflare tunnel.
 *  - One KoBo plugin: demo login and campus-email verification, so both sit behind the same limiter.
 */

export interface AuthOptions {
  prisma: PrismaClient
  /** Public origin, e.g. https://kobo.example. Secure cookies follow its scheme. */
  baseURL: string
  secret: string
  /** Extra origins allowed to call the API with cookies (the Vite dev server). */
  trustedOrigins?: string[]
}

/** Paths a demo account may never use. Session-based; checked against the caller's user. */
const DEMO_BLOCKED_PATHS = new Set(['/change-password', '/set-password', '/change-email', '/delete-user', '/campus-email/request'])
/** Paths that act on an account identified by an email in the body rather than by session. */
const DEMO_BLOCKED_BY_EMAIL = new Set(['/request-password-reset', '/send-verification-email'])

const demoForbidden = () =>
  new APIError('FORBIDDEN', { message: 'Akun demo bersifat hanya-baca: kata sandi, email, dan penghapusan akun tidak dapat diubah.', code: 'DEMO_ACCOUNT_READONLY' })

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
        if (!user || !(user as { isDemo?: boolean }).isDemo) throw new APIError('NOT_FOUND', { message: 'Akun demo belum tersedia.', code: 'DEMO_NOT_SEEDED' })
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
        await prisma.user.update({
          where: { id: user.id },
          data: { campusEmail: claim.email, campusEmailVerifiedAt: new Date(), ...(campus && !user.campus ? { campus: campus.shortName } : {}) },
        })
        throw ctx.redirect('/profile?campus=verified')
      }),
    },
  }
}

export function createAuth({ prisma, baseURL, secret, trustedOrigins = [] }: AuthOptions) {
  return betterAuth({
    baseURL,
    secret,
    trustedOrigins,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
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
      },
    },

    advanced: {
      // Production trusts only Cloudflare's header. X-Forwarded-For is client-controlled, so it is accepted in dev only.
      ipAddress: { ipAddressHeaders: process.env.NODE_ENV === 'production' ? ['cf-connecting-ip'] : ['cf-connecting-ip', 'x-forwarded-for'] },
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

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
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
