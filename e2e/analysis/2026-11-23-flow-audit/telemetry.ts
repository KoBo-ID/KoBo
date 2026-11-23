import { test as base, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const REPO_ROOT = path.resolve(__dirname, '../../..')
export const EVIDENCE_DIR = path.join(REPO_ROOT, 'notes/analysis/2026-11-23-flow-audit/evidence')
export const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, 'screenshots')
export const TELEMETRY_CSV = path.join(EVIDENCE_DIR, 'flow-telemetry.csv')
export const OBSERVATIONS_JSONL = path.join(EVIDENCE_DIR, 'observed-behaviors.jsonl')

export const AUDIT_DB_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@127.0.0.1:5433/kobo_e2e_flow_audit'
if (!AUDIT_DB_URL.includes('kobo_e2e_flow_audit')) {
  throw new Error(`[AUDIT GUARD] Refusing non-isolated DB URL: ${AUDIT_DB_URL}`)
}

export const BASE_URL = `http://127.0.0.1:${process.env.AUDIT_PORT ?? '3110'}`
export const E2E_CALLBACK_TOKEN = 'e2e-callback-token'
export const E2E_BUSINESS_ID = 'kobo-e2e-business'

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

const CSV_HEADER = [
  'case_id',
  'flow_id',
  'domain',
  'persona',
  'viewport',
  'gate_profile',
  'status',
  'assertions_passed',
  'assertions_failed',
  'dead_end_hit',
  'state_sync_mismatch',
  'optimal_steps',
  'actual_steps',
  'efficiency_ratio',
  'click_count',
  'duration_ms',
  'max_interaction_latency_ms',
  'console_error_count',
  'page_error_count',
  'unexpected_http_4xx_5xx_count',
  'lcp_ms',
  'cls_score',
  'horizontal_overflow_px',
  'min_interactive_target_px',
  'keyboard_completable',
  'focus_visible_ok',
  'aria_status_announced',
  'broken_img_count',
  'unnamed_icon_btn_count',
  'nested_interactive_count',
  'screenshot_paths',
  'notes',
].join(',')

export function ensureTelemetryHeader() {
  if (!fs.existsSync(TELEMETRY_CSV)) {
    fs.writeFileSync(TELEMETRY_CSV, CSV_HEADER + '\n', 'utf8')
  }
}

function csvEsc(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export interface TelemetryRow {
  case_id: string
  flow_id: string
  domain: string
  persona: string
  viewport: string
  gate_profile: 'P1' | 'P2' | 'P3'
  status: 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED'
  assertions_passed: number
  assertions_failed: number
  dead_end_hit: number
  state_sync_mismatch: number
  optimal_steps: number
  actual_steps: number
  click_count: number
  duration_ms: number
  max_interaction_latency_ms: number
  console_error_count: number
  page_error_count: number
  unexpected_http_4xx_5xx_count: number
  lcp_ms: number | null
  cls_score: number | null
  horizontal_overflow_px: number
  min_interactive_target_px: number | null
  keyboard_completable: 'yes' | 'partial' | 'no' | 'n/a'
  focus_visible_ok: 'yes' | 'no' | 'n/a'
  aria_status_announced: 'yes' | 'no' | 'n/a'
  broken_img_count: number
  unnamed_icon_btn_count: number
  nested_interactive_count: number
  screenshot_paths: string[]
  notes: string
}

export function appendTelemetry(row: TelemetryRow) {
  ensureTelemetryHeader()
  const ratio = row.optimal_steps > 0 ? +(row.actual_steps / row.optimal_steps).toFixed(2) : 1
  const cols = [
    row.case_id,
    row.flow_id,
    row.domain,
    row.persona,
    row.viewport,
    row.gate_profile,
    row.status,
    row.assertions_passed,
    row.assertions_failed,
    row.dead_end_hit,
    row.state_sync_mismatch,
    row.optimal_steps,
    row.actual_steps,
    ratio,
    row.click_count,
    Math.round(row.duration_ms),
    Math.round(row.max_interaction_latency_ms),
    row.console_error_count,
    row.page_error_count,
    row.unexpected_http_4xx_5xx_count,
    row.lcp_ms === null ? '' : Math.round(row.lcp_ms),
    row.cls_score === null ? '' : Number(row.cls_score.toFixed(4)),
    Math.round(row.horizontal_overflow_px),
    row.min_interactive_target_px === null ? '' : Math.round(row.min_interactive_target_px),
    row.keyboard_completable,
    row.focus_visible_ok,
    row.aria_status_announced,
    row.broken_img_count,
    row.unnamed_icon_btn_count,
    row.nested_interactive_count,
    row.screenshot_paths.join(';'),
    row.notes,
  ]
  fs.appendFileSync(TELEMETRY_CSV, cols.map(csvEsc).join(',') + '\n', 'utf8')
}

export function logObservation(entry: Record<string, unknown>) {
  fs.appendFileSync(OBSERVATIONS_JSONL, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8')
}

export interface PageProbe {
  consoleErrors: string[]
  pageErrors: string[]
  httpErrors: { status: number; url: string }[]
  allowedHttpPatterns: RegExp[]
  allowHttp: (re: RegExp) => void
  unexpectedHttpErrors: () => { status: number; url: string }[]
  unexpectedConsoleErrors: () => string[]
  measureDom: () => Promise<DomAuditMetrics>
  snap: (name: string, fullPage?: boolean) => Promise<string>
  measureAction: <T>(fn: () => Promise<T>) => Promise<{ result: T; latencyMs: number }>
  maxLatencyMs: number
  clicks: number
  screenshots: string[]
}

export interface DomAuditMetrics {
  lcpMs: number | null
  cls: number | null
  horizontalOverflowPx: number
  minInteractiveTargetPx: number | null
  brokenImgCount: number
  unnamedIconBtnCount: number
  nestedInteractiveCount: number
  h1Count: number
  mainCount: number
  duplicateIdCount: number
}

const PERF_INIT_SCRIPT = () => {
  const w = window as unknown as { __auditPerf?: { lcp: number | null; cls: number } }
  w.__auditPerf = { lcp: null, cls: 0 }
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1]
      if (last) w.__auditPerf!.lcp = last.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { hadRecentInput?: boolean; value?: number }[]) {
        if (!e.hadRecentInput && typeof e.value === 'number') {
          w.__auditPerf!.cls += e.value
        }
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {}
}

export async function attachProbe(page: Page): Promise<PageProbe> {
  await page.addInitScript(PERF_INIT_SCRIPT)
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const httpErrors: { status: number; url: string }[] = []
  const allowedHttpPatterns: RegExp[] = []
  const screenshots: string[] = []
  const probe: PageProbe = {
    consoleErrors,
    pageErrors,
    httpErrors,
    allowedHttpPatterns,
    maxLatencyMs: 0,
    clicks: 0,
    screenshots,
    allowHttp(re: RegExp) {
      allowedHttpPatterns.push(re)
    },
    unexpectedHttpErrors() {
      return httpErrors.filter((h) => !allowedHttpPatterns.some((re) => re.test(`${h.status} ${h.url}`)))
    },
    unexpectedConsoleErrors() {
      // Filter standard browser "Failed to load resource: the server responded with a status of 4xx" when whitelisted
      return consoleErrors.filter((msg) => {
        if (!msg.includes('Failed to load resource')) return true
        const m = msg.match(/status of (\d{3})/)
        if (!m) return true
        const code = Number(m[1])
        return !httpErrors.some((h) => h.status === code && allowedHttpPatterns.some((re) => re.test(`${h.status} ${h.url}`)))
      })
    },
    async measureAction<T>(fn: () => Promise<T>) {
      const t0 = Date.now()
      const result = await fn()
      const latencyMs = Date.now() - t0
      if (latencyMs > probe.maxLatencyMs) probe.maxLatencyMs = latencyMs
      probe.clicks += 1
      return { result, latencyMs }
    },
    async snap(name: string, fullPage = false) {
      const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.png'
      const abs = path.join(SCREENSHOT_DIR, safe)
      await page.screenshot({ path: abs, fullPage })
      const rel = `evidence/screenshots/${safe}`
      screenshots.push(rel)
      return rel
    },
    async measureDom(): Promise<DomAuditMetrics> {
      return page.evaluate(() => {
        const w = window as unknown as { __auditPerf?: { lcp: number | null; cls: number } }
        const overflow = Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
        const imgs = Array.from(document.querySelectorAll('img')).filter((i) => {
          const r = i.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })
        const brokenImgCount = imgs.filter((i) => i.complete && i.naturalWidth === 0).length

        const interactives = Array.from(document.querySelectorAll<HTMLElement>('a, button, input, select, textarea, [role="button"], [role="tab"]'))
          .filter((el) => {
            const style = getComputedStyle(el)
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0 && !el.classList.contains('skip-link')
          })

        let minTarget: number | null = null
        let unnamedIconBtnCount = 0
        for (const el of interactives) {
          const r = el.getBoundingClientRect()
          const dim = Math.min(r.width, r.height)
          if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.tagName === 'A') {
            if (minTarget === null || dim < minTarget) minTarget = dim
          }
          if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
            const text = (el.innerText || '').trim()
            const aria = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || '').trim()
            if (!text && !aria) unnamedIconBtnCount += 1
          }
        }

        const nestedInteractiveCount = document.querySelectorAll('a button, button a, a a, button button').length
        const h1Count = document.querySelectorAll('h1').length
        const mainCount = document.querySelectorAll('main').length
        const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id).filter(Boolean)
        const duplicateIdCount = ids.length - new Set(ids).size

        return {
          lcpMs: w.__auditPerf?.lcp ?? null,
          cls: w.__auditPerf?.cls ?? null,
          horizontalOverflowPx: overflow,
          minInteractiveTargetPx: minTarget,
          brokenImgCount,
          unnamedIconBtnCount,
          nestedInteractiveCount,
          h1Count,
          mainCount,
          duplicateIdCount,
        }
      })
    },
  }

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const url = res.url()
      // Ignore third-party map tiles if offline/rate-limited
      if (url.includes('127.0.0.1')) {
        httpErrors.push({ status: res.status(), url })
      }
    }
  })

  return probe
}

// ---------- DB & Auth & Seam Helpers (strictly isolated to kobo_e2e_flow_audit) ----------

let ipCounter = 1
export const uniqueIp = () => `10.99.${Math.floor(Math.random() * 240) + 1}.${(ipCounter++ % 240) + 1}`

export async function ownIp(page: Page) {
  const ip = uniqueIp()
  await page.route('**/api/auth/**', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }),
  )
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: AUDIT_DB_URL })
  await client.connect()
  try {
    return (await client.query(text, params)).rows as T[]
  } finally {
    await client.end()
  }
}

export async function outboxCode(to: string, template: string, notCode?: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const rows = await sql<{ payload: { code?: string } }>(
      'SELECT payload FROM "EmailOutbox" WHERE "to" = $1 AND template = $2 ORDER BY "createdAt" DESC LIMIT 1',
      [to, template],
    )
    const code = rows[0]?.payload?.code
    if (code && code !== notCode) return code
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`No ${template} code in EmailOutbox for ${to}`)
}

export async function outboxLink(to: string, template: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const rows = await sql<{ payload: { url?: string } }>(
      'SELECT payload FROM "EmailOutbox" WHERE "to" = $1 AND template = $2 ORDER BY "createdAt" DESC LIMIT 1',
      [to, template],
    )
    const url = rows[0]?.payload?.url
    if (url) return url
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`No ${template} link in EmailOutbox for ${to}`)
}

type Requester = APIRequestContext | Page | BrowserContext
const requestOf = (who: Requester): APIRequestContext => ('request' in who ? who.request : who)

export async function trpcPost<T>(who: Requester, proc: string, data: unknown): Promise<T> {
  const res = await requestOf(who).post(`${BASE_URL}/api/trpc/${proc}`, { data, headers: { origin: BASE_URL } })
  const txt = await res.text()
  expect(res.ok(), `trpcPost ${proc} failed (${res.status()}): ${txt}`).toBe(true)
  const body = JSON.parse(txt) as { result: { data: { json?: T } & T } }
  return (body.result.data.json ?? body.result.data) as T
}

export async function trpcGet<T>(who: Requester, proc: string, input?: unknown): Promise<T> {
  const q = input !== undefined ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ''
  const res = await requestOf(who).get(`${BASE_URL}/api/trpc/${proc}${q}`)
  const txt = await res.text()
  expect(res.ok(), `trpcGet ${proc} failed (${res.status()}): ${txt}`).toBe(true)
  const body = JSON.parse(txt) as { result: { data: { json?: T } & T } }
  return (body.result.data.json ?? body.result.data) as T
}

export async function trpcRaw(who: Requester, proc: string, data: unknown, method: 'POST' | 'GET' = 'POST') {
  const res =
    method === 'POST'
      ? await requestOf(who).post(`${BASE_URL}/api/trpc/${proc}`, { data, headers: { origin: BASE_URL } })
      : await requestOf(who).get(`${BASE_URL}/api/trpc/${proc}${data !== undefined ? `?input=${encodeURIComponent(JSON.stringify(data))}` : ''}`)
  let body: { error?: { message?: string; data?: { code?: string } }; result?: { data: { json?: unknown } & Record<string, unknown> } } = {}
  try {
    body = (await res.json()) as typeof body
  } catch {}
  return {
    status: res.status(),
    message: body.error?.message,
    code: body.error?.data?.code,
    data: body.result ? (body.result.data.json ?? body.result.data) : undefined,
  }
}

export async function loginDemo(page: Page, persona: 'student' | 'owner') {
  const res = await page.context().request.post(`${BASE_URL}/api/auth/demo-login`, {
    data: { as: persona },
    headers: { origin: BASE_URL, 'cf-connecting-ip': uniqueIp() },
  })
  expect(res.ok(), `demo-login ${persona}`).toBe(true)
}

export async function signUpVerified(page: Page, label: string, name = 'Mahasiswa Audit') {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e5)}@example.com`
  const headers = { origin: BASE_URL, 'cf-connecting-ip': uniqueIp() }
  const up = await page.context().request.post(`${BASE_URL}/api/auth/sign-up/email`, {
    data: { name, email, password: 'Sandi-audit-123' },
    headers,
  })
  expect(up.ok(), `sign-up ${email}: ${await up.text()}`).toBe(true)
  const otp = await outboxCode(email, 'verify-email')
  const ver = await page.context().request.post(`${BASE_URL}/api/auth/email-otp/verify-email`, {
    data: { email, otp },
    headers,
  })
  expect(ver.ok(), `verify-email ${email}`).toBe(true)
  const [{ id: userId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [email])
  return { email, userId, password: 'Sandi-audit-123' }
}

export async function newAuditContext(browser: Browser, viewport = { width: 1280, height: 650 }) {
  const ctx = await browser.newContext({ baseURL: BASE_URL, viewport, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await ownIp(page)
  const probe = await attachProbe(page)
  return { ctx, page, probe }
}

export async function grantStudentVerified(userId: string, campusId: string | null = 'binus-syahdan', campus = 'BINUS', days = 365) {
  await sql(
    `UPDATE "User" SET campus = $2, "campusEmail" = $3, "campusEmailVerifiedAt" = now(), "campusVerifiedVia" = 'EMAIL', "campusVerifiedUntil" = now() + make_interval(days => $4), "verifiedCampusId" = $5 WHERE id = $1`,
    [userId, campus, `ver-${userId.slice(0, 8)}-${Date.now()}@binus.ac.id`, days, campusId],
  )
}

export async function grantConsents(page: Page) {
  await trpcPost(page, 'auth.updateEmergencyContact', {
    name: 'Ibu Wali Audit',
    relation: 'Ibu',
    phone: '081234567890',
    consent: true,
  })
  await trpcPost(page, 'auth.acceptTerms', { version: '2026-10-28-draf' })
}

export async function newVerifiedStudent(
  browser: Browser,
  opts: { label: string; campusId?: string | null; campus?: string; consents?: boolean; viewport?: { width: number; height: number } },
) {
  const { ctx, page, probe } = await newAuditContext(browser, opts.viewport)
  const { email, userId, password } = await signUpVerified(page, opts.label)
  if (opts.campusId !== undefined) {
    await grantStudentVerified(userId, opts.campusId, opts.campus ?? 'BINUS')
  }
  if (opts.consents) {
    await grantConsents(page)
  }
  return { ctx, page, probe, email, userId, password }
}

export async function newApprovedOwner(
  browser: Browser,
  opts: { label: string; rooms?: number; price?: number; discount?: number; maxOccupants?: number; approve?: boolean },
) {
  const { ctx, page, probe } = await newAuditContext(browser)
  const { email, userId } = await signUpVerified(page, opts.label, `Pemilik ${opts.label}`)
  await trpcPost(page, 'owner.becomeOwner', { phone: '081234567890', ownershipType: 'PEMILIK' })
  if (opts.approve !== false) {
    await sql(`UPDATE "OwnerProfile" SET "approvedAt" = now(), "verificationStatus" = 'DISETUJUI' WHERE "userId" = $1`, [userId])
  }
  let kosId = ''
  let kosName = ''
  let rooms: { id: string; roomNumber: string }[] = []
  if (opts.approve !== false && (opts.rooms ?? 2) > 0) {
    kosName = `Kos Audit ${opts.label} ${Date.now()}`
    const created = await trpcPost<{ id: string }>(page, 'owner.kos.create', {
      name: kosName,
      gender: 'CAMPUR',
      address: 'Jl. Audit Flow No. 10',
      district: 'Kemanggisan',
      city: 'Jakarta Barat',
      lat: -6.2015,
      lng: 106.7825,
      electricityType: 'INCLUDED',
      privateAmenities: [],
      sharedAmenities: [],
      studentDiscountAmount: opts.discount ?? 100_000,
      initialRooms: { count: opts.rooms ?? 2, priceMonthly: opts.price ?? 1_500_000 },
    })
    kosId = created.id
    const mine = await trpcGet<{ id: string; rooms: { id: string; roomNumber: string; floor: number; type: string; size: string; bedType: string; priceMonthly: number }[] }[]>(page, 'owner.myKos')
    const fullRooms = mine.find((k) => k.id === kosId)!.rooms
    rooms = fullRooms.map((r) => ({ id: r.id, roomNumber: r.roomNumber }))
    if (opts.maxOccupants && opts.maxOccupants > 1) {
      for (const r of fullRooms) {
        await trpcPost(page, 'owner.room.update', {
          kosId,
          roomId: r.id,
          roomNumber: r.roomNumber,
          floor: r.floor,
          type: r.type,
          size: r.size,
          bedType: r.bedType,
          priceMonthly: r.priceMonthly,
          maxOccupants: opts.maxOccupants,
        })
      }
    }
  }
  return { ctx, page, probe, email, userId, kosId, kosName, rooms }
}

export function wibDate(plusDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + plusDays * 86_400_000))
}

export async function hook<T = unknown>(who: Requester, p: string, body: unknown): Promise<T> {
  const res = await requestOf(who).post(`${BASE_URL}/api/__e2e/${p}`, { data: body })
  const json = (await res.json()) as { ok: boolean; result?: T; error?: string }
  expect(res.ok() && json.ok, `hook ${p}: ${JSON.stringify(json)}`).toBe(true)
  return json.result as T
}

export const tick = (who: Requester, worker: 'sweep' | 'refunds' | 'waitlist' | 'outbox' | 'notify', now?: string | Date) =>
  hook(who, 'tick', { worker, ...(now ? { now: new Date(now).toISOString() } : {}) })

export const xendit = {
  session: (who: Requester, paymentId: string, state: 'ACTIVE' | 'COMPLETED' | 'EXPIRED') =>
    hook(who, 'xendit/session', { paymentId, state }),
  refundMode: (who: Requester, paymentId: string, mode: 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'ERROR') =>
    hook(who, 'xendit/refund', { paymentId, mode }),
  outage: (who: Requester, invoiceId: string) => hook(who, 'xendit/outage', { invoiceId }),
}

export async function webhook(who: Requester, body: unknown, token: string | null = E2E_CALLBACK_TOKEN) {
  const res = await requestOf(who).post(`${BASE_URL}/api/webhooks/xendit`, {
    data: body,
    headers: token === null ? {} : { 'x-callback-token': token },
  })
  return { status: res.status(), json: (await res.json()) as { ok: boolean; result?: string; error?: string } }
}

export function sessionCompleted(paymentId: string, amount: number, at?: string | Date) {
  const iso = new Date(at ?? Date.now()).toISOString()
  return {
    event: 'payment_session.completed',
    business_id: E2E_BUSINESS_ID,
    created: iso,
    data: {
      payment_session_id: `ps_e2e_${paymentId}`,
      reference_id: paymentId,
      amount,
      currency: 'IDR',
      status: 'COMPLETED',
      updated: iso,
      payment_request_id: `pr_e2e_${paymentId}`,
      payment_id: `py_e2e_${paymentId}`,
    },
  }
}

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

export function runBackendCli(scriptRelPath: string, args: string[]) {
  const backendDir = path.join(REPO_ROOT, 'backend')
  const tsxCli = path.join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs')
  const res = spawnSync(process.execPath, [tsxCli, scriptRelPath, ...args], {
    cwd: backendDir,
    env: {
      ...process.env,
      DATABASE_URL: AUDIT_DB_URL,
      ALLOW_FAKE_STORAGE: '1',
      ALLOW_CONSOLE_EMAIL: '1',
      RESEND_API_KEY: '',
    },
    encoding: 'utf8',
  })
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

/** Minimal valid JPEG bytes (passes magic-byte check FF D8 FF). */
export const MINIMAL_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0x7f, 0x00, 0xff, 0xd9,
])

/** Minimal valid PDF bytes (passes %PDF- magic-byte check). */
export const MINIMAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'utf8')

export const test = base
export { expect }
