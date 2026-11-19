import type { Context } from 'hono'

/*
 * Liveness of the app and its background workers (E-08).
 *
 * Every worker records a heartbeat after a SUCCESSFUL tick (beat / heartbeatJob) and GET /api/health reports them. A worker that has not
 * beaten for its threshold (about 3x its interval, 26 h for the daily crons) is `stale`, which turns the overall status into `degraded`.
 *
 * Status codes: 200 for ok AND degraded, 503 only when the database is down. The uptime monitor and the container healthcheck should page
 * on "the app or its database is gone", not on one slow worker (the rolling deploy would otherwise roll back on a flaky tick); stale
 * workers are visible in the body and through the per-worker Healthchecks.io pings below, which alert on their own.
 *
 * Reuse for a new worker: `registerWorker(name, thresholdMs)` once at start, `beat(name)` after each good tick (or wrap the job with
 * heartbeatJob). Nothing here reads secrets; the body carries no error text.
 */

export interface WorkerHealth {
  lastOkAt: string | null
  stale: boolean
}
export interface HealthSnapshot {
  status: 'ok' | 'degraded'
  db: 'ok' | 'down'
  workers: Record<string, WorkerHealth>
  version?: string
}

/** Stale threshold for an interval worker: three missed ticks. */
export const staleAfter = (intervalMs: number): number => intervalMs * 3
/** Stale threshold for a daily cron: one day plus two hours of slack. */
export const DAILY_STALE_MS = 26 * 3_600_000
/** A worker ticking every 15 s must not ping Healthchecks.io 240 times an hour: at most one ping per worker per minute. */
const PING_MIN_GAP_MS = 60_000
const PING_TIMEOUT_MS = 5_000

interface WorkerState {
  thresholdMs: number
  registeredAt: number
  lastOk: number | null
  lastPing: number
}
const workers = new Map<string, WorkerState>()

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>
let pingBaseOverride: string | null | undefined
let fetchOverride: FetchLike | undefined
let warned = false

/** Test seam: `base` replaces HEALTHCHECKS_PING_BASE (null = off), `fetch` replaces the global fetch. Call with no argument to reset. */
export function configureHeartbeat(opts: { base?: string | null; fetch?: FetchLike } = {}): void {
  pingBaseOverride = opts.base
  fetchOverride = opts.fetch
  warned = false
}

export function registerWorker(name: string, thresholdMs: number, now: number = Date.now()): void {
  const existing = workers.get(name)
  workers.set(name, { thresholdMs, registeredAt: now, lastOk: existing?.lastOk ?? null, lastPing: existing?.lastPing ?? 0 })
}

/** Records a good tick and (when HEALTHCHECKS_PING_BASE is set) pings `${base}/${name}` without blocking or ever throwing. */
export function beat(name: string, now: number = Date.now()): void {
  const w = workers.get(name)
  if (!w) return
  w.lastOk = now
  const base = (pingBaseOverride !== undefined ? pingBaseOverride : process.env.HEALTHCHECKS_PING_BASE)?.trim().replace(/\/+$/, '')
  if (!base || now - w.lastPing < PING_MIN_GAP_MS) return
  w.lastPing = now
  try {
    const f: FetchLike = fetchOverride ?? ((url, init) => fetch(url, init))
    void Promise.resolve(f(`${base}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) })).catch(warnOnce)
  } catch (err) {
    warnOnce(err)
  }
}

function warnOnce(err: unknown): void {
  if (warned) return
  warned = true
  console.warn('[health] healthcheck ping failed (further failures not logged):', err instanceof Error ? err.message : err)
}

/** Registers `name` and returns `job` wrapped so that a tick that resolves counts as a heartbeat. */
export function heartbeatJob<T>(name: string, intervalMs: number, job: () => Promise<T>): () => Promise<T> {
  registerWorker(name, staleAfter(intervalMs))
  return async () => {
    const result = await job()
    beat(name)
    return result
  }
}

export function snapshot(now: number = Date.now()): Record<string, WorkerHealth> {
  const out: Record<string, WorkerHealth> = {}
  for (const [name, w] of workers) {
    out[name] = { lastOkAt: w.lastOk === null ? null : new Date(w.lastOk).toISOString(), stale: now - (w.lastOk ?? w.registeredAt) > w.thresholdMs }
  }
  return out
}

/** Test only. */
export function resetHealthRegistry(): void {
  workers.clear()
  configureHeartbeat()
}

const DB_TIMEOUT_MS = 2_000

export interface HealthOptions {
  /** Resolves when the database answers (SELECT 1); rejects otherwise. */
  checkDb: () => Promise<unknown>
  now?: () => number
  /** Default 2 s. */
  dbTimeoutMs?: number
}

export async function buildHealth({ checkDb, now = Date.now, dbTimeoutMs = DB_TIMEOUT_MS }: HealthOptions): Promise<{ body: HealthSnapshot & { ok: boolean }; httpStatus: 200 | 503 }> {
  let db: 'ok' | 'down' = 'ok'
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([checkDb(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('db timeout')), dbTimeoutMs)))])
  } catch {
    db = 'down'
  } finally {
    clearTimeout(timer)
  }
  const ws = snapshot(now())
  const degraded = db === 'down' || Object.values(ws).some((w) => w.stale)
  const version = process.env.APP_VERSION?.trim()
  // `ok` mirrors the old { ok: true } body so existing probes (CI greps '"ok":true') keep working.
  const body = { ok: db === 'ok', status: degraded ? 'degraded' : 'ok', db, workers: ws, ...(version ? { version } : {}) } as HealthSnapshot & { ok: boolean }
  return { body, httpStatus: db === 'ok' ? 200 : 503 }
}

export function healthHandler(options: HealthOptions) {
  return async (c: Context) => {
    const { body, httpStatus } = await buildHealth(options)
    return c.json(body, httpStatus)
  }
}
