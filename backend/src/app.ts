import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { Hono } from 'hono'
import { createAuth } from './auth.ts'
import type { Auth } from './auth.ts'
import type { PrismaClient } from './db/client.ts'
import { authEnv, paymentWebhookSecret } from './env.ts'
import { handlePaymentWebhook } from './payments.ts'
import { DEV_UPLOAD_PREFIX, storageFromEnv } from './storage.ts'
import type { FakeStorage, Storage } from './storage.ts'
import { appRouter } from './trpc/router.ts'
import type { Context, Session } from './trpc/trpc.ts'

export interface AppOptions {
  prisma: PrismaClient
  /** Built SPA directory (frontend/dist). When omitted, no static files are served. */
  distDir?: string
  /** Defaults to createAuth() from BETTER_AUTH_URL / BETTER_AUTH_SECRET. */
  auth?: Auth
  /** Defaults to storageFromEnv(): R2 when configured, else the in-memory fake. */
  storage?: Storage
}

const IMMUTABLE = 'public, max-age=31536000, immutable'
const NO_CACHE = 'no-cache'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

async function readIfFile(root: string, urlPath: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const full = normalize(join(root, decodeURIComponent(urlPath)))
  if (full !== root && !full.startsWith(root + sep)) return null // path traversal
  try {
    if (!(await stat(full)).isFile()) return null
    return new Uint8Array(await readFile(full))
  } catch {
    return null
  }
}

export function createApp({ prisma, distDir, auth = createAuth({ prisma, ...authEnv() }), storage = storageFromEnv() }: AppOptions) {
  const app = new Hono()

  app.get('/health', async (c) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false }, 503)
    }
  })

  // better-auth owns everything under /api/auth (sign-in/up, verify-email, demo-login, campus-email, ...).
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    const res = await auth.handler(c.req.raw)
    // Unknown auth paths must be JSON like every other /api miss, never an empty body.
    return res.status === 404 && !res.headers.get('content-type')?.includes('json') ? c.json({ error: 'Not found' }, 404) : res
  })

  // Payment gateway callback: HMAC over the raw body (never a re-serialised one), idempotent on externalId.
  app.post('/api/webhooks/payment', async (c) => {
    const rawBody = await c.req.text()
    const res = await handlePaymentWebhook(prisma, { rawBody, signature: c.req.header('x-signature'), secret: paymentWebhookSecret() })
    return c.json(res.body, res.status)
  })

  // Dev/e2e only: the fake storage's presigned URLs point here. Never mounted when R2 is configured.
  if (storage.kind === 'fake') mountDevUploads(app, storage as FakeStorage)

  app.all('/api/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/api/trpc',
      req: c.req.raw,
      router: appRouter,
      // Session-dependent answers must never be cached by the browser or an intermediary.
      responseMeta: ({ paths }) => (paths?.some((p) => p.startsWith('auth.')) ? { headers: { 'Cache-Control': 'no-store' } } : {}),
      createContext: ({ req, resHeaders }): Context => {
        let session: Promise<Session | null> | undefined
        return {
          prisma,
          auth,
          storage,
          headers: req.headers,
          resHeaders,
          getSession: () => (session ??= auth.api.getSession({ headers: req.headers })),
        }
      },
    }),
  )

  // Anything else under /api is JSON, never the SPA shell.
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

  if (distDir) {
    const root = normalize(distDir)
    app.get('*', async (c) => {
      const path = c.req.path
      if (path.startsWith('/assets/')) {
        // Hashed build output. A miss must be a real 404 so stale tabs fail their chunk import cleanly.
        const file = await readIfFile(root, path)
        if (!file) return c.text('Not found', 404)
        return c.body(file, 200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream', 'Cache-Control': IMMUTABLE })
      }
      if (path !== '/' && path !== '/index.html') {
        const file = await readIfFile(root, path)
        if (file) return c.body(file, 200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' })
      }
      const index = await readIfFile(root, '/index.html')
      if (!index) return c.text('Not found', 404)
      return c.body(index, 200, { 'Content-Type': MIME['.html'], 'Cache-Control': NO_CACHE })
    })
  }

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)))

  return app
}

/** PUT stores the body if it matches what was "signed" (type, length, expiry); GET serves it back so photos render. */
function mountDevUploads(app: Hono, fake: FakeStorage) {
  app.put(`${DEV_UPLOAD_PREFIX}*`, async (c) => {
    const key = decodeURIComponent(c.req.path.slice(DEV_UPLOAD_PREFIX.length))
    const q = c.req.query()
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    const type = c.req.header('content-type') ?? ''
    if (Number(q.exp) < Date.now()) return c.json({ error: 'Expired' }, 403)
    if (type !== q.ct || bytes.byteLength !== Number(q.len)) return c.json({ error: 'Signature mismatch' }, 403)
    fake.put(key, bytes, type)
    return c.body(null, 200)
  })
  app.get(`${DEV_UPLOAD_PREFIX}*`, (c) => {
    const o = fake.get(decodeURIComponent(c.req.path.slice(DEV_UPLOAD_PREFIX.length)))
    if (!o) return c.json({ error: 'Not found' }, 404)
    return c.body(o.bytes as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': o.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' })
  })
}
