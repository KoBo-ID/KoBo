import { existsSync } from 'node:fs'

// backend/.env (dev). In production the container gets real env vars and no file.
for (const p of ['.env']) {
  if (existsSync(p)) {
    process.loadEnvFile(p)
    break
  }
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const v = env[name]
  if (!v) throw new Error(`Missing required env var ${name}`)
  return v
}

/** Comma-separated env list: entries trimmed, empty ones dropped. */
export const parseList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

/**
 * Auth configuration. BETTER_AUTH_URL is the public site origin: email links (verify, reset, campus, receipts,
 * waitlist offers) point at it and better-auth's CSRF check compares the browser's Origin with it. In production
 * a localhost or http value is a misconfiguration that silently breaks every emailed link, so refuse to start.
 * ALLOW_INSECURE_AUTH_URL=1 opts the production-mode e2e server (http://localhost) out of that check.
 */
export function authEnv(env: NodeJS.ProcessEnv = process.env) {
  const baseURL = requireEnv('BETTER_AUTH_URL', env).trim().replace(/\/+$/, '')
  const production = env.NODE_ENV === 'production'

  if (production && env.ALLOW_INSECURE_AUTH_URL !== '1') {
    let url: URL | null = null
    try {
      url = new URL(baseURL)
    } catch {
      // reported below
    }
    if (!url || url.protocol !== 'https:' || LOCAL_HOSTS.has(url.hostname) || url.pathname !== '/') {
      throw new Error(
        `[auth] BETTER_AUTH_URL="${baseURL}" is not a public https origin. In production it must be the public site origin ` +
          'the browser uses (the frontend, e.g. https://<project>.vercel.app or your custom domain), with no trailing slash and no /api path.',
      )
    }
  }

  const ipHeaders = parseList(env.AUTH_IP_HEADERS).map((h) => h.toLowerCase())

  return {
    baseURL,
    secret: requireEnv('BETTER_AUTH_SECRET', env),
    // Dev: the Vite dev server proxies /api but keeps its own Origin, which better-auth's CSRF check must accept.
    // TRUSTED_ORIGINS adds more (e.g. Vercel preview domains) in any environment.
    trustedOrigins: [...new Set([...(production ? [] : ['http://localhost:5173']), ...parseList(env.TRUSTED_ORIGINS).map((o) => o.replace(/\/+$/, ''))])],
    // Unset: createAuth's default (cf-connecting-ip in production). Behind Vercel -> Railway use x-forwarded-for.
    ipAddressHeaders: ipHeaders.length > 0 ? ipHeaders : undefined,
  }
}

/** HMAC secret shared by POST /api/webhooks/payment and the in-app payment simulator. */
export const paymentWebhookSecret = () => requireEnv('PAYMENT_WEBHOOK_SECRET')
