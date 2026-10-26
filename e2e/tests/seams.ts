import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { ownIp, signUpVerified } from './accounts'

// Test-only seams for the booking/payment specs. They talk to the guarded /api/__e2e/* hooks (ALLOW_E2E_HOOKS=1, set only by
// e2e/start-server.mjs), to the fake Xendit provider's webhook, and straight to the e2e database for time travel.
// Every scenario builds its own world (own users, kos, rooms) so parallel specs never share state.

export const E2E_CALLBACK_TOKEN = 'e2e-callback-token'
export const E2E_BUSINESS_ID = 'kobo-e2e-business'

type Requester = APIRequestContext | Page | BrowserContext
const requestOf = (who: Requester): APIRequestContext => ('request' in who ? who.request : who)
const originHeader = () => ({ origin: new URL(test.info().project.use.baseURL as string).origin })

// ---------- database ----------

/** One query against the e2e database (own connection per call, no pool to leak). */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@localhost:5433/kobo_e2e' })
  await client.connect()
  try {
    return (await client.query(text, params)).rows as T[]
  } finally {
    await client.end()
  }
}

// ---------- hooks ----------

/** POST a JSON body to a guarded /api/__e2e hook and return its `result`. */
export async function hook<T = unknown>(who: Requester, path: string, body: unknown): Promise<T> {
  const res = await requestOf(who).post(`/api/__e2e/${path}`, { data: body })
  const json = (await res.json()) as { ok: boolean; result?: T; error?: string }
  expect(res.ok() && json.ok, `e2e hook ${path}: ${JSON.stringify(json)}`).toBe(true)
  return json.result as T
}

export type TickWorker = 'sweep' | 'refunds' | 'waitlist' | 'outbox'
/** Run one worker pass now. `now` moves the clock the worker uses (ISO string or Date). Ticks are global: assert only your own rows. */
export function tick(who: Requester, worker: TickWorker, now?: string | Date) {
  return hook<unknown>(who, 'tick', { worker, ...(now ? { now: new Date(now).toISOString() } : {}) })
}

export type SessionState = 'ACTIVE' | 'COMPLETED' | 'EXPIRED'
export type RefundMode = 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'ERROR'
/** Steer the fake Xendit provider. */
export const xendit = {
  /** What the provider reports for a payment's session (used by the sweep and Periksa Status). */
  session: (who: Requester, paymentId: string, state: SessionState) => hook(who, 'xendit/session', { paymentId, state }),
  /** How the provider answers the next refund request for a payment. */
  refundMode: (who: Requester, paymentId: string, mode: RefundMode) => hook(who, 'xendit/refund', { paymentId, mode }),
  /** The next checkout creation for this invoice fails once with a retryable 503. */
  outage: (who: Requester, invoiceId: string) => hook(who, 'xendit/outage', { invoiceId }),
}

// ---------- webhooks ----------

/** POST a provider event to the real webhook endpoint. json.result is the outcome: SETTLED, EXPIRED, DUPLICATE, UNMATCHED, IGNORED, REJECTED, REFUND_*. */
export async function webhook(who: Requester, body: unknown, token: string | null = E2E_CALLBACK_TOKEN) {
  const res = await requestOf(who).post('/api/webhooks/xendit', {
    data: body,
    headers: token === null ? {} : { 'x-callback-token': token },
  })
  return { status: res.status(), json: (await res.json()) as { ok: boolean; result?: string; error?: string } }
}

const iso = (at?: string | Date) => new Date(at ?? Date.now()).toISOString()

/** payment_session.completed for a fake-provider payment. Amount must equal the payment amount. */
export function sessionCompleted(paymentId: string, amount: number, at?: string | Date) {
  return {
    event: 'payment_session.completed',
    business_id: E2E_BUSINESS_ID,
    created: iso(at),
    data: {
      payment_session_id: `ps_e2e_${paymentId}`,
      reference_id: paymentId,
      amount,
      currency: 'IDR',
      status: 'COMPLETED',
      updated: iso(at),
      payment_request_id: `pr_e2e_${paymentId}`,
      payment_id: `py_e2e_${paymentId}`,
    },
  }
}

/** payment_session.expired. `referenceId` defaults to the payment id; pass another to simulate an unknown reference. */
export function sessionExpired(paymentId: string, referenceId: string = paymentId, at?: string | Date) {
  return {
    event: 'payment_session.expired',
    business_id: E2E_BUSINESS_ID,
    created: iso(at),
    data: { payment_session_id: `ps_e2e_${paymentId}`, reference_id: referenceId, status: 'EXPIRED', updated: iso(at) },
  }
}

export interface RefundRow {
  paymentId: string
  referenceId: string
  amount: number
  providerRefundId: string | null
}
/** refund.succeeded / refund.failed for a PaymentRefund row (see {@link refundOf}). */
export function refundEvent(kind: 'succeeded' | 'failed', refund: RefundRow, at?: string | Date) {
  return {
    event: `refund.${kind}`,
    business_id: E2E_BUSINESS_ID,
    created: iso(at),
    data: {
      id: refund.providerRefundId ?? `rf_e2e_${refund.referenceId}`,
      reference_id: refund.referenceId,
      payment_request_id: `pr_e2e_${refund.paymentId}`,
      amount: refund.amount,
      currency: 'IDR',
      status: kind === 'succeeded' ? 'SUCCEEDED' : 'FAILED',
      ...(kind === 'failed' ? { failure_code: 'E2E_FAILURE' } : {}),
      updated: iso(at),
    },
  }
}

/** The PaymentRefund row of a payment, or undefined while none exists. */
export async function refundOf(paymentId: string) {
  return (await sql<RefundRow & { status: string }>('SELECT "paymentId", "referenceId", amount, "providerRefundId", status FROM "PaymentRefund" WHERE "paymentId" = $1', [paymentId]))[0]
}

/** Latest payment of an invoice (id, status, amount). */
export async function latestPayment(invoiceId: string) {
  return (await sql<{ id: string; status: string; amount: number; provider: string }>('SELECT id, status, amount, provider FROM "Payment" WHERE "invoiceId" = $1 ORDER BY "createdAt" DESC LIMIT 1', [invoiceId]))[0]
}

// ---------- hosted checkout stub ----------

/**
 * Answer the fake provider's hosted checkout (https://checkout-staging.xendit.co/**) with a tiny page: "Bayar (simulasi)"
 * leads to the success return URL, "Batalkan" to the failure one. Paying there does NOT mark anything paid: only a webhook does.
 * Call before any real-user pay click.
 */
export async function stubXenditCheckout(context: BrowserContext) {
  await context.route('https://checkout-staging.xendit.co/**', async (route) => {
    const url = new URL(route.request().url())
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Checkout simulasi</title></head><body>
<h1>Checkout simulasi</h1>
<a href="${esc(url.searchParams.get('success') ?? '/')}">Bayar (simulasi)</a>
<a href="${esc(url.searchParams.get('failure') ?? '/')}">Batalkan</a>
</body></html>`,
    })
  })
}

// ---------- time travel (by data) ----------

/** The hold lapsed `minutesAgo` minutes ago: Tenancy.expiresAt and any live attempt's expiresAt move into the past. */
export async function expireHold(tenancyId: string, minutesAgo = 1) {
  await sql(`UPDATE "Tenancy" SET "expiresAt" = now() - make_interval(mins => $2) WHERE id = $1`, [tenancyId, minutesAgo])
  await sql(
    `UPDATE "Payment" SET "expiresAt" = LEAST(COALESCE("expiresAt", now()), now() - make_interval(mins => $2))
     WHERE status IN ('CREATING','PENDING') AND "invoiceId" IN (SELECT id FROM "Invoice" WHERE "tenancyId" = $1)`,
    [tenancyId, minutesAgo],
  )
}

/** One payment attempt's session lapsed (status EXPIRED too: a PENDING attempt past expiresAt never shows the restart hint). The hold is untouched. */
export async function expireAttempt(paymentId: string, minutesAgo = 1) {
  await sql(`UPDATE "Payment" SET status = 'EXPIRED', "expiresAt" = now() - make_interval(mins => $2) WHERE id = $1`, [paymentId, minutesAgo])
}

/** Make an attempt look `minutes` old, so the sweep's grace period no longer protects it. */
export async function ageAttempt(paymentId: string, minutes: number) {
  await sql(`UPDATE "Payment" SET "createdAt" = now() - make_interval(mins => $2) WHERE id = $1`, [paymentId, minutes])
}

/** An attempt stuck in CREATING for 3 minutes (older than the 2 minute limit). */
export async function staleCreating(paymentId: string) {
  await sql(`UPDATE "Payment" SET status = 'CREATING', "createdAt" = now() - interval '3 minutes' WHERE id = $1`, [paymentId])
}

/** Move the dates of a tenancy's UNPAID invoices `days` into the past (due / overdue states). */
export async function shiftDueDates(tenancyId: string, days: number) {
  await sql(`UPDATE "Invoice" SET "dueDate" = "dueDate" - $2::int, "periodStart" = "periodStart" - $2::int WHERE "tenancyId" = $1 AND status = 'UNPAID'`, [tenancyId, days])
}

/** A waitlist offer that has already run out (the waitlist tick then passes it on). */
export async function expireOffer(entryId: string) {
  await sql(`UPDATE "WaitlistEntry" SET "offerExpiresAt" = now() - interval '1 minute' WHERE id = $1`, [entryId])
}

/** Delete every session of a user: their next request is signed out. */
export async function expireSession(userId: string) {
  await sql(`DELETE FROM "Session" WHERE "userId" = $1`, [userId])
}

// ---------- factory ----------

export async function trpcPost<T>(who: Requester, proc: string, data: unknown): Promise<T> {
  const res = await requestOf(who).post(`/api/trpc/${proc}`, { data, headers: originHeader() })
  expect(res.ok(), `${proc}: ${res.status()} ${res.ok() ? '' : await res.text()}`).toBe(true)
  return unwrap<T>(await res.json())
}
export async function trpcGet<T>(who: Requester, proc: string): Promise<T> {
  const res = await requestOf(who).get(`/api/trpc/${proc}`)
  expect(res.ok(), `${proc}: ${res.status()}`).toBe(true)
  return unwrap<T>(await res.json())
}
/** A tRPC call that may fail on purpose: returns the HTTP status and the server's message instead of asserting success. */
export async function trpcRaw(who: Requester, proc: string, data: unknown) {
  const res = await requestOf(who).post(`/api/trpc/${proc}`, { data, headers: originHeader() })
  const body = (await res.json()) as { error?: { message?: string; data?: { code?: string } }; result?: { data: { json?: unknown } & Record<string, unknown> } }
  return { status: res.status(), message: body.error?.message, code: body.error?.data?.code, data: body.result ? (body.result.data.json ?? body.result.data) : undefined }
}

function unwrap<T>(body: unknown): T {
  const data = (body as { result: { data: { json?: T } & T } }).result.data
  return (data.json ?? data) as T
}

/** An extra signed-in browser context + page on the same base URL. Close `ctx` when done. */
export async function newContext(browser: Browser) {
  const baseURL = test.info().project.use.baseURL as string
  const ctx = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await ownIp(page) // its own client address for /api/auth, so parallel pages do not share one rate-limit bucket
  return { ctx, page }
}

export interface Student {
  ctx: BrowserContext
  page: Page
  email: string
  userId: string
}
/**
 * A fresh, email-verified student in its own context. `demo` flags it isDemo (MOCK provider, Selesaikan Pembayaran);
 * without it the account takes the fake-Xendit path. `campus` gives it a verified campus email (student discount).
 */
export async function newStudent(browser: Browser, opts: { label: string; demo?: boolean; campus?: boolean }): Promise<Student> {
  const { ctx, page } = await newContext(browser)
  const email = await signUpVerified(page, opts.label)
  const [{ id: userId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [email])
  if (opts.demo) await sql('UPDATE "User" SET "isDemo" = true WHERE id = $1', [userId])
  if (opts.campus) {
    await sql('UPDATE "User" SET campus = $2, "campusEmail" = $3, "campusEmailVerifiedAt" = now() WHERE id = $1', [userId, 'BINUS', `${opts.label}${Date.now()}@student.binus.ac.id`])
  }
  return { ctx, page, email, userId }
}

export interface OwnerWorld {
  ctx: BrowserContext
  page: Page
  email: string
  userId: string
  kosId: string
  kosName: string
  rooms: { id: string; roomNumber: string }[]
}
/** A real (non-demo) owner with one kos and `rooms` vacant rooms. `discount` is the student discount per month. */
export async function newOwnerWorld(browser: Browser, opts: { label: string; rooms?: number; price?: number; discount?: number }): Promise<OwnerWorld> {
  const { ctx, page } = await newContext(browser)
  const email = await signUpVerified(page, opts.label)
  const [{ id: userId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [email])
  await trpcPost(page, 'owner.becomeOwner', {})
  const kosName = `Kos ${opts.label} ${Date.now()}`
  const { id: kosId } = await trpcPost<{ id: string }>(page, 'owner.kos.create', {
    name: kosName,
    gender: 'CAMPUR',
    address: 'Jl. Seam No. 1',
    district: 'Kebayoran Baru',
    city: 'Jakarta Selatan',
    lat: -6.2,
    lng: 106.8,
    electricityType: 'INCLUDED',
    privateAmenities: [],
    sharedAmenities: [],
    studentDiscountAmount: opts.discount ?? 0,
    initialRooms: { count: opts.rooms ?? 2, priceMonthly: opts.price ?? 1_500_000 },
  })
  const mine = await trpcGet<{ id: string; rooms: { id: string; roomNumber: string }[] }[]>(page, 'owner.myKos')
  const rooms = mine.find((k) => k.id === kosId)!.rooms
  return { ctx, page, email, userId, kosId, kosName, rooms }
}

/** Submit a rental application as `student`. Returns the application id. */
export async function apply(student: Student | BrowserContext, roomId: string, opts: { startInDays?: number; months?: number; occupation?: string } = {}) {
  const who = 'ctx' in student ? student.ctx : student
  const startDate = new Date(Date.now() + (opts.startInDays ?? 3) * 86_400_000).toISOString().slice(0, 10)
  const app = await trpcPost<{ id: string }>(who, 'application.create', { roomId, startDate, durationMonths: opts.months ?? 3, occupation: opts.occupation ?? 'Mahasiswa' })
  return app.id
}

/** Owner approves an application: PENDING tenancy with a hold and an UNPAID first invoice. */
export async function approve(owner: OwnerWorld | BrowserContext, kosId: string, applicationId: string) {
  const who = 'ctx' in owner ? owner.ctx : owner
  await trpcPost(who, 'application.decide', { kosId, applicationId, decision: 'APPROVE' })
}

export interface HeldRoom {
  owner: OwnerWorld
  student: Student
  roomId: string
  applicationId: string
  tenancyId: string
  invoiceId: string
}
/** `student` applies for `roomId` and `owner` approves: the room is held. Returns the ids a test needs. */
export async function hold(owner: OwnerWorld, student: Student, roomId: string, opts: { months?: number } = {}) {
  const applicationId = await apply(student, roomId, { months: opts.months })
  await approve(owner, owner.kosId, applicationId)
  const [{ tenancyId }] = await sql<{ tenancyId: string }>('SELECT "tenancyId" FROM "RentalApplication" WHERE id = $1', [applicationId])
  const [{ id: invoiceId }] = await sql<{ id: string }>('SELECT id FROM "Invoice" WHERE "tenancyId" = $1 ORDER BY "periodStart" LIMIT 1', [tenancyId])
  return { applicationId, tenancyId, invoiceId }
}

/** Owner + student + an approved application: the student holds a room and owes the first invoice (nothing paid yet). */
export async function heldRoom(browser: Browser, opts: { label: string; demo?: boolean; campus?: boolean; price?: number; discount?: number; months?: number }): Promise<HeldRoom> {
  const owner = await newOwnerWorld(browser, { label: `${opts.label}-own`, rooms: 1, price: opts.price, discount: opts.discount })
  const student = await newStudent(browser, { label: `${opts.label}-stu`, demo: opts.demo, campus: opts.campus })
  const roomId = owner.rooms[0].id
  const applicationId = await apply(student, roomId, { months: opts.months })
  await approve(owner, owner.kosId, applicationId)
  const [{ tenancyId }] = await sql<{ tenancyId: string }>('SELECT "tenancyId" FROM "RentalApplication" WHERE id = $1', [applicationId])
  const [{ id: invoiceId }] = await sql<{ id: string }>('SELECT id FROM "Invoice" WHERE "tenancyId" = $1 ORDER BY "periodStart" LIMIT 1', [tenancyId])
  return { owner, student, roomId, applicationId, tenancyId, invoiceId }
}

// ---------- page watching ----------

/**
 * Collect console errors and uncaught exceptions of a secondary page into `problems` (the fixture only watches the default
 * page). Use the same array to filter expected 4xx/5xx noise, then `problems.splice(0)`.
 */
export function watch(page: Page, problems: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
}

/**
 * Drain the browser's console errors for requests that were meant to fail (the browser logs every 4xx/5xx as one).
 * Anything else left in `problems` still fails the test.
 */
export function expectHttpErrors(problems: string[], ...statuses: number[]) {
  const rest = problems.filter((p) => !statuses.some((s) => p.includes(`status of ${s}`)))
  problems.splice(0)
  expect(rest, 'unexpected console errors').toEqual([])
}
