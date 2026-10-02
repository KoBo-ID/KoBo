import '../src/env.ts'
import { createApp } from '../src/app.ts'
import { createAuth } from '../src/auth.ts'
import { createPrisma } from '../src/db/client.ts'
import { createFakeStorage } from '../src/storage.ts'
import { createCallerFactory } from '../src/trpc/trpc.ts'
import type { Context } from '../src/trpc/trpc.ts'
import { appRouter } from '../src/trpc/router.ts'

export const prisma = createPrisma(process.env.TEST_DATABASE_URL ?? '')
export const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
export const secret = process.env.BETTER_AUTH_SECRET ?? ''
export const auth = createAuth({ prisma, baseURL, secret })
export const storage = createFakeStorage()
export const app = createApp({ prisma, auth, storage })

const makeCaller = createCallerFactory(appRouter)

function contextFor(userId: string | null): Context {
  const session = userId ? ({ user: { id: userId }, session: { userId } } as never) : null
  return { prisma, auth, storage, headers: new Headers(), resHeaders: new Headers(), getSession: async () => session }
}

/** tRPC caller with no session. */
export const caller = makeCaller(contextFor(null))

/** tRPC caller authenticated as the given user id (the session lookup is stubbed, no cookies involved). */
export function callerFor(userId: string) {
  return makeCaller(contextFor(userId))
}

// better-auth's limiter is process-global and keyed by (ip, path), so every test client gets a fresh IP.
let ipCounter = 0
export const nextIp = () => `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`

export interface ReqOptions {
  method?: string
  body?: unknown
  /** Value for cf-connecting-ip (the only header better-auth trusts for the client address). */
  ip?: string
  cookie?: string
  headers?: Record<string, string>
}

/** Fire a request straight into the Hono app (no sockets). */
export function request(path: string, opts: ReqOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { origin: baseURL, 'cf-connecting-ip': opts.ip ?? nextIp(), ...opts.headers }
  if (opts.cookie) headers.cookie = opts.cookie
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body)
  if (body !== undefined) headers['content-type'] = 'application/json'
  return Promise.resolve(app.request(path, { method: opts.method ?? (body === undefined ? 'GET' : 'POST'), headers, body }))
}

/** "name=value; name2=value2" cookie header from a response's Set-Cookie headers. */
export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='))
    .join('; ')
}

/** The path+query of a link stored in an outbox payload, ready for app.request. */
export function pathOf(url: string): string {
  const u = new URL(url)
  return u.pathname + u.search
}

export async function lastEmail(template: string, to?: string) {
  const rows = await prisma.emailOutbox.findMany({ where: { template, ...(to ? { to } : {}) }, orderBy: { createdAt: 'desc' }, take: 1 })
  return rows[0] ? { ...rows[0], payload: rows[0].payload as { url: string; name: string } } : undefined
}

/** Register a password account and verify it through the emailed link. Returns a signed-in session cookie. */
export async function registerAndSignIn(email: string, password = 'Sandi-rahasia-123', name = 'Penguji') {
  const up = await request('/api/auth/sign-up/email', { body: { name, email, password } })
  if (up.status !== 200) throw new Error(`sign-up failed: ${up.status} ${await up.text()}`)
  const mail = await lastEmail('verify-email', email)
  if (!mail) throw new Error('no verification email queued')
  const verify = await request(pathOf(mail.payload.url))
  if (verify.status >= 400) throw new Error(`verify failed: ${verify.status} ${await verify.text()}`)
  const inn = await request('/api/auth/sign-in/email', { body: { email, password } })
  if (inn.status !== 200) throw new Error(`sign-in failed: ${inn.status} ${await inn.text()}`)
  return cookieFrom(inn)
}

export async function demoCookie(as: 'student' | 'owner') {
  const res = await request('/api/auth/demo-login', { body: { as } })
  if (res.status !== 200) throw new Error(`demo login failed: ${res.status} ${await res.text()}`)
  return cookieFrom(res)
}

export async function me(cookie?: string) {
  const res = await request('/api/trpc/auth.me', { cookie })
  return ((await res.json()) as { result: { data: unknown } }).result.data as null | {
    user: { id: string; email: string; isDemo: boolean }
    isOwner: boolean
    ownerProfileId: string | null
    campusVerified: boolean
  }
}

export const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET ?? ''

/** POST a signed (or deliberately mis-signed) payment webhook straight into the app. */
export async function postWebhook(body: unknown, opts: { signature?: string | null; secret?: string } = {}): Promise<Response> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const { createHmac } = await import('node:crypto')
  const sig = opts.signature === undefined ? createHmac('sha256', opts.secret ?? webhookSecret).update(raw).digest('hex') : opts.signature
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (sig !== null) headers['x-signature'] = sig
  return Promise.resolve(app.request('/api/webhooks/payment', { method: 'POST', headers, body: raw }))
}

export const DEMO_STUDENT_ID = 'user-demo-student'

/** A room with no live (ACTIVE, or PENDING and unexpired) tenancy and no PENDING row at all. */
export async function vacantRoom(nth = 0) {
  const rooms = await prisma.room.findMany({
    where: { tenancies: { none: { status: { in: ['ACTIVE', 'PENDING'] } } } },
    orderBy: { id: 'asc' },
    include: { kos: true },
    take: nth + 1,
  })
  if (!rooms[nth]) throw new Error('no vacant room in seed')
  return rooms[nth]
}

let userSeq = 0
/** A fresh student with no history (seed pool users already carry ENDED tenancies). */
export async function newStudent() {
  const n = ++userSeq
  return prisma.user.create({ data: { id: `test-student-${n}`, name: `Tester ${n}`, email: `tester-${n}@kobo.test`, emailVerified: true } })
}
