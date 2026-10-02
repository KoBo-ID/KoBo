import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.ts'
import { createPrisma } from '../../src/db/client.ts'
import { resetDb } from '../../src/db/seed.ts'
import { prisma } from '../helpers.ts'

// Small fixture instead of frontend/dist so the test never depends on a frontend build.
const distDir = fileURLToPath(new URL('../fixtures/spa', import.meta.url))
const app = createApp({ prisma, distDir })

beforeEach(() => resetDb(prisma))

describe('GET /health', () => {
  it('reports ok when the database answers SELECT 1', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns 503 when the database is unreachable', async () => {
    const bad = createApp({ prisma: createPrisma('postgresql://kobo:kobo@127.0.0.1:1/none') })
    const res = await bad.request('/health')
    expect(res.status).toBe(503)
  })
})

describe('/api', () => {
  it('serves tRPC over HTTP at /api/trpc', async () => {
    const res = await app.request('/api/trpc/kos.list?input=' + encodeURIComponent(JSON.stringify({ limit: 1 })))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { data: { id: string }[] } }
    expect(body.result.data).toHaveLength(1)
  })

  it('answers unknown /api paths with a JSON 404', async () => {
    for (const path of ['/api/nope', '/api/auth/anything']) {
      const res = await app.request(path)
      expect(res.status).toBe(404)
      expect(res.headers.get('content-type')).toContain('application/json')
    }
  })
})

describe('SPA serving', () => {
  it('falls back to index.html (no-cache) for non-api paths', async () => {
    for (const path of ['/', '/search', '/kos/kos-1']) {
      const res = await app.request(path)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(await res.text()).toContain('KoBo fixture shell')
    }
  })

  it('serves hashed assets as immutable', async () => {
    const res = await app.request('/assets/app-abc123.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('content-type')).toContain('javascript')
  })

  it('404s a missing asset instead of returning the HTML shell', async () => {
    const res = await app.request('/assets/gone-deadbeef.js')
    expect(res.status).toBe(404)
  })

  it('does not escape the dist directory', async () => {
    const res = await app.request('/..%2f..%2fpackage.json')
    expect(await res.text()).not.toContain('"workspaces"')
  })
})
