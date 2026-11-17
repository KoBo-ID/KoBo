import '../src/env.ts'
import { randomUUID } from 'node:crypto'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { createApp } from '../src/app.ts'
import { createAuth } from '../src/auth.ts'
import { NoGeocoder, type Geocoder } from '../src/geocode.ts'
import { createPrisma } from '../src/db/client.ts'
import { MOCK_BUSINESS_ID, mockCompletedEvent, MockPaymentProvider } from '../src/payment/mock.ts'
import { PaymentService } from '../src/payment/service.ts'
import { applyPaymentEventTx } from '../src/payment/settlement.ts'
import type { RateLimiter } from '../src/rateLimit.ts'
import { createFakeStorage } from '../src/storage.ts'
import { createCallerFactory } from '../src/trpc/trpc.ts'
import type { Context } from '../src/trpc/trpc.ts'
import { appRouter } from '../src/trpc/router.ts'

export const TEST_CALLBACK_TOKEN = 'test-callback-token-0123456789'
export const TEST_BUSINESS_ID = 'biz_test'

export const prisma = createPrisma(process.env.TEST_DATABASE_URL ?? '')
export const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
export const secret = process.env.BETTER_AUTH_SECRET ?? ''
export const auth = createAuth({ prisma, baseURL, secret })
export const storage = createFakeStorage()
export const paymentService = new PaymentService({ defaultProvider: new MockPaymentProvider(), xenditWebhook: { callbackToken: TEST_CALLBACK_TOKEN, businessId: TEST_BUSINESS_ID } })
export const app = createApp({ prisma, auth, storage, paymentService })

const makeCaller = createCallerFactory(appRouter)

interface CallerOptions {
  isDemo?: boolean
  paymentService?: PaymentService
  geocoder?: Geocoder
  limiter?: RateLimiter
}

function contextFor(userId: string | null, options: CallerOptions = {}): Context {
  const session = userId ? ({ user: { id: userId, isDemo: options.isDemo ?? false }, session: { userId } } as never) : null
  return { prisma, auth, storage, paymentService: options.paymentService ?? paymentService, geocoder: options.geocoder ?? new NoGeocoder(), limiter: options.limiter, headers: new Headers(), resHeaders: new Headers(), getSession: async () => session }
}

/** tRPC caller with no session. */
export const caller = makeCaller(contextFor(null))

/** tRPC caller authenticated as the given user id (the session lookup is stubbed, no cookies involved). */
export function callerFor(userId: string, options: CallerOptions = {}) {
  return makeCaller(contextFor(userId, options))
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
    ownerApproved: boolean | null
    campusVerified: boolean
  }
}

/** POST a Xendit callback straight into the app; `token: null` omits the x-callback-token header. */
export async function postXenditWebhook(body: unknown, opts: { token?: string | null } = {}): Promise<Response> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = opts.token === undefined ? TEST_CALLBACK_TOKEN : opts.token
  if (token !== null) headers['x-callback-token'] = token
  return Promise.resolve(app.request('/api/webhooks/xendit', { method: 'POST', headers, body: raw }))
}

/** A payment_session.completed/expired callback body for an attempt row. */
export function sessionWebhook(
  type: 'completed' | 'expired',
  p: { id: string; amount: number; providerSessionId: string | null },
  over: { data?: Record<string, unknown>; businessId?: string; updated?: string } = {},
) {
  const updated = over.updated ?? '2026-10-14T03:00:00.000Z'
  return {
    event: `payment_session.${type}`,
    business_id: over.businessId ?? TEST_BUSINESS_ID,
    created: updated,
    data: {
      payment_session_id: p.providerSessionId ?? `ps_${p.id}`,
      reference_id: p.id,
      amount: p.amount,
      currency: 'IDR',
      status: type === 'completed' ? 'COMPLETED' : 'EXPIRED',
      updated,
      ...(type === 'completed' ? { payment_request_id: `pr_${p.id}`, payment_id: `py_${p.id}` } : {}),
      ...over.data,
    },
  }
}

/** Settle a MOCK attempt the way the in-app simulator does (normalized event straight into settlement). */
export const settleMock = async (paymentId: string) => {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
  return applyPaymentEventTx(prisma, { provider: 'MOCK', expectedBusinessId: MOCK_BUSINESS_ID }, mockCompletedEvent(payment, new Date()))
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

interface ApprovalFixtureOptions {
  startDate?: string
  durationMonths?: number
  occupation?: string
  note?: string
}

/** Exercise the real application workflow; direct booking is intentionally not part of the public API. */
export async function approveApplication(userId: string, roomId: string, options: ApprovalFixtureOptions = {}) {
  const room = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    include: { kos: { include: { owner: { select: { userId: true } } } } },
  })
  const renter = callerFor(userId)
  const application = await renter.application.create({
    roomId,
    startDate: options.startDate ?? addDays(todayWIB(new Date()), 3),
    durationMonths: options.durationMonths ?? 3,
    occupation: options.occupation ?? 'Mahasiswa',
    note: options.note,
  })
  const decision = await callerFor(room.kos.owner.userId).application.decide({
    kosId: room.kosId,
    applicationId: application.id,
    decision: 'APPROVE',
  })
  if (!decision.tenancyId) throw new Error('application approval did not create a tenancy')
  const tenancy = await prisma.tenancy.findUniqueOrThrow({
    where: { id: decision.tenancyId },
    include: { invoices: { orderBy: [{ dueDate: 'asc' }, { id: 'asc' }] } },
  })
  const invoice = tenancy.invoices[0]
  if (!invoice) throw new Error('application approval did not create an invoice')
  return { applicationId: application.id, tenancyId: tenancy.id, invoiceId: invoice.id, tenancy, invoice, room }
}

/** Transitional fixture for settlement tests until payment.start owns attempt creation in Task 5. */
export async function createPendingMockPayment(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { amount: true } })
  const sessionId = `mock_session_${randomUUID()}`
  return prisma.payment.create({
    data: { invoiceId, provider: 'MOCK', providerSessionId: sessionId, providerBusinessId: MOCK_BUSINESS_ID, amount: invoice.amount, status: 'PENDING' },
  })
}

/** A valid CASH recordManual input for an invoice (amount read from the database, as the owner would re-type it). */
export async function cash(kosId: string, invoiceId: string, over: Record<string, unknown> = {}) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { amount: true } })
  return { kosId, invoiceId, method: 'CASH' as const, confirmedAmount: invoice.amount, ...over }
}

/** Let any online attempt on the invoice lapse so an owner can record a manual payment. */
export const lapseAttempts = (invoiceId: string) =>
  prisma.payment.updateMany({ where: { invoiceId, status: { in: ['CREATING', 'PENDING'] } }, data: { expiresAt: new Date(Date.now() - 1000) } })
