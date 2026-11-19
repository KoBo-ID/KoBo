import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { beat, buildHealth, configureHeartbeat, DAILY_STALE_MS, heartbeatJob, registerWorker, resetHealthRegistry, snapshot, staleAfter } from '../../src/health.ts'
import { prisma } from '../helpers.ts'

const T0 = Date.UTC(2026, 10, 19, 12, 0, 0)

beforeEach(() => resetHealthRegistry())
afterEach(() => resetHealthRegistry())

describe('worker heartbeats', () => {
  it('is fresh right after a beat and stale once 3x the interval has passed', () => {
    registerWorker('outbox', staleAfter(15_000), T0)
    beat('outbox', T0)
    expect(snapshot(T0 + 45_000).outbox).toEqual({ lastOkAt: new Date(T0).toISOString(), stale: false })
    expect(snapshot(T0 + 45_001).outbox.stale).toBe(true)
    beat('outbox', T0 + 50_000)
    expect(snapshot(T0 + 60_000).outbox.stale).toBe(false)
  })

  it('a worker that never beat has lastOkAt null and goes stale from its registration time', () => {
    registerWorker('refunds', 45_000, T0)
    expect(snapshot(T0 + 1_000).refunds).toEqual({ lastOkAt: null, stale: false })
    expect(snapshot(T0 + 46_000).refunds).toEqual({ lastOkAt: null, stale: true })
  })

  it('daily crons tolerate 26 hours', () => {
    registerWorker('demo-reset', DAILY_STALE_MS, T0)
    beat('demo-reset', T0)
    expect(snapshot(T0 + 25 * 3_600_000)['demo-reset'].stale).toBe(false)
    expect(snapshot(T0 + 27 * 3_600_000)['demo-reset'].stale).toBe(true)
  })

  it('heartbeatJob beats only when the job resolves', async () => {
    const ok = heartbeatJob('good', 15_000, async () => 'done')
    const bad = heartbeatJob('bad', 15_000, async () => {
      throw new Error('boom')
    })
    expect(await ok()).toBe('done')
    await expect(bad()).rejects.toThrow('boom')
    const s = snapshot()
    expect(s.good.lastOkAt).not.toBeNull()
    expect(s.bad.lastOkAt).toBeNull()
  })
})

describe('buildHealth', () => {
  it('ok / 200 with the documented shape and no worker problems', async () => {
    registerWorker('outbox', 45_000, T0)
    beat('outbox', T0)
    const { body, httpStatus } = await buildHealth({ checkDb: async () => 1, now: () => T0 + 1_000 })
    expect(httpStatus).toBe(200)
    expect(body).toMatchObject({ status: 'ok', db: 'ok', workers: { outbox: { lastOkAt: new Date(T0).toISOString(), stale: false } } })
  })

  it('a stale worker degrades the status but stays 200', async () => {
    registerWorker('outbox', 45_000, T0)
    const { body, httpStatus } = await buildHealth({ checkDb: async () => 1, now: () => T0 + 600_000 })
    expect(httpStatus).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.db).toBe('ok')
    expect(body.workers.outbox.stale).toBe(true)
  })

  it('503 and no error details when the database check fails or hangs', async () => {
    const failed = await buildHealth({
      checkDb: async () => {
        throw new Error('password authentication failed for user kobo')
      },
    })
    expect(failed.httpStatus).toBe(503)
    expect(failed.body).toMatchObject({ status: 'degraded', db: 'down' })
    expect(JSON.stringify(failed.body)).not.toContain('password')
    const hung = await buildHealth({ checkDb: () => new Promise(() => {}), dbTimeoutMs: 20 })
    expect(hung.httpStatus).toBe(503)
  })
})

describe('GET /api/health', () => {
  it('serves the JSON over HTTP, 200 when the database answers', async () => {
    const res = await createApp({ prisma }).request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', db: 'ok', workers: {} })
  })

  it('answers 503 on /api/health but keeps the plain /health probe, when the database is down', async () => {
    const app = createApp({ prisma, checkDb: () => Promise.reject(new Error('down')) })
    const res = await app.request('/api/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ status: 'degraded', db: 'down' })
    const plain = await app.request('/health')
    expect(plain.status).toBe(503)
    expect(await plain.json()).toEqual({ ok: false })
  })
})

describe('Healthchecks pings', () => {
  it('pings ${base}/${worker} after a good tick, with a timeout signal', async () => {
    const fetch = vi.fn(async () => ({}))
    configureHeartbeat({ base: 'https://hc-ping.com/abc-key/', fetch })
    registerWorker('outbox', 45_000, T0)
    beat('outbox', T0)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { signal: AbortSignal }]
    expect(url).toBe('https://hc-ping.com/abc-key/outbox')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    beat('outbox', T0 + 15_000) // throttled: at most one ping a minute per worker
    expect(fetch).toHaveBeenCalledTimes(1)
    beat('outbox', T0 + 61_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('never pings when HEALTHCHECKS_PING_BASE is unset', () => {
    const fetch = vi.fn(async () => ({}))
    vi.stubEnv('HEALTHCHECKS_PING_BASE', '')
    configureHeartbeat({ fetch })
    registerWorker('outbox', 45_000, T0)
    beat('outbox', T0)
    expect(fetch).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('swallows ping failures and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    configureHeartbeat({ base: 'https://hc-ping.com/k', fetch: () => Promise.reject(new Error('network')) })
    registerWorker('a', 45_000, T0)
    beat('a', T0)
    beat('a', T0 + 120_000)
    await new Promise((r) => setTimeout(r, 10))
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
