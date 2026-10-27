import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { Hono } from 'hono'
import type { Context as HonoContext } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { createAuth } from './auth.ts'
import type { Auth } from './auth.ts'
import type { PrismaClient } from './db/client.ts'
import type { E2eHooks } from './e2eHooks.ts'
import { mountE2eHooks } from './e2eHooks.ts'
import { authEnv } from './env.ts'
import { geocoderFromEnv, type Geocoder } from './geocode.ts'
import { paymentServiceFromEnv } from './payment/service.ts'
import type { PaymentService } from './payment/service.ts'
import { handleXenditWebhook, MAX_WEBHOOK_BYTES } from './payment/webhook.ts'
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
  /** Defaults to the provider selected by PAYMENT_PROVIDER. Tests inject a network-free service explicitly. */
  paymentService?: PaymentService
  geocoder?: Geocoder
  /** Test/e2e only (ALLOW_E2E_HOOKS=1, see e2eHooks.ts). Mounts /api/__e2e/*; absent in every real deployment. */
  e2eHooks?: E2eHooks | null
}

/** Largest tRPC request body. Real inputs are a few KB; 256 KiB leaves room for long text fields. */
const MAX_TRPC_BYTES = 256 * 1024
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

export function createApp({ prisma, distDir, auth = createAuth({ prisma, ...authEnv() }), storage = storageFromEnv(), paymentService = paymentServiceFromEnv(), geocoder = geocoderFromEnv(), e2eHooks = null }: AppOptions) {
  const app = new Hono()

  // Response hardening for the SPA and the API (OWASP HTTP Headers Cheat Sheet; Hono secureHeaders defaults otherwise).
  //  - X-Frame-Options DENY plus CSP frame-ancestors 'none': the app is never framed (clickjacking of approve / pay buttons).
  //  - Referrer-Policy strict-origin-when-cross-origin (not Hono's no-referrer): map tile servers require a Referer origin.
  //  - COOP / CORP off: OAuth and payment redirects are plain navigations, and nothing here needs cross-origin isolation.
  //  - The CSP carries only origin-independent directives; a script/style/img allow-list is a separate, tested change.
  app.use(
    '*',
    secureHeaders({
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: { frameAncestors: ["'none'"], baseUri: ["'self'"], objectSrc: ["'none'"], formAction: ["'self'"] },
    }),
  )

  // /health for the platform probe; /api/health for anything that reaches the app through the Vercel rewrite, where
  // /health would be answered by the SPA fallback instead of this service.
  const health = async (c: HonoContext) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false }, 503)
    }
  }
  app.get('/health', health)
  app.get('/api/health', health)

  // better-auth owns everything under /api/auth (sign-in/up, verify-email, demo-login, campus-email, ...).
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    const res = await auth.handler(c.req.raw)
    // Unknown auth paths must be JSON like every other /api miss, never an empty body.
    return res.status === 404 && !res.headers.get('content-type')?.includes('json') ? c.json({ error: 'Not found' }, 404) : res
  })

  // Xendit callback: authenticated by x-callback-token; the raw body is read once and never logged.
  app.post(
    '/api/webhooks/xendit',
    // Rejects an oversized body from its Content-Length / stream BEFORE it is buffered, and before any authentication.
    bodyLimit({ maxSize: MAX_WEBHOOK_BYTES, onError: (c) => c.json({ ok: false, error: 'Body terlalu besar.' }, 413) }),
    async (c) => {
    const cfg = paymentService.xenditWebhook
    if (!cfg) return c.json({ error: 'Not found' }, 404)
    const res = await handleXenditWebhook(prisma, cfg, { rawBody: await c.req.text(), token: c.req.header('x-callback-token') })
    return c.json(res.body, res.status)
    },
  )

  // Dev/e2e only: the fake storage's presigned URLs point here. Never mounted when R2 is configured.
  if (storage.kind === 'fake') mountDevUploads(app, storage as FakeStorage)

  // Inputs are small JSON documents (photos go straight to R2): refuse anything bigger before it is buffered and parsed.
  app.use(
    '/api/trpc/*',
    bodyLimit({
      maxSize: MAX_TRPC_BYTES,
      onError: (c) => c.json({ error: { message: 'Permintaan terlalu besar.', code: -32600, data: { code: 'PAYLOAD_TOO_LARGE', httpStatus: 413 } } }, 413),
    }),
  )
  app.all('/api/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/api/trpc',
      req: c.req.raw,
      router: appRouter,
      // Answers can depend on the session (kos.detail carries the caller's own offer, every owner/student read is private),
      // so no RPC response is stored by the browser or an intermediary.
      responseMeta: () => ({ headers: { 'Cache-Control': 'no-store' } }),
      createContext: ({ req, resHeaders }): Context => {
        let session: Promise<Session | null> | undefined
        return {
          prisma,
          auth,
          storage,
          paymentService,
          geocoder,
          headers: req.headers,
          resHeaders,
          getSession: () => (session ??= auth.api.getSession({ headers: req.headers })),
        }
      },
    }),
  )

  if (e2eHooks) mountE2eHooks(app, prisma, e2eHooks)

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
    if (!fake.verifyUpload(key, q)) return c.json({ error: 'Signature mismatch' }, 403)
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
