import { existsSync } from 'node:fs'

// backend/.env (dev). In production the container gets real env vars and no file.
for (const p of ['.env']) {
  if (existsSync(p)) {
    process.loadEnvFile(p)
    break
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var ${name}`)
  return v
}

/** Auth configuration. BETTER_AUTH_URL must be the public https origin in production (secure cookies, link targets). */
export function authEnv() {
  const baseURL = requireEnv('BETTER_AUTH_URL')
  return {
    baseURL,
    secret: requireEnv('BETTER_AUTH_SECRET'),
    // The Vite dev server proxies /api but keeps its own Origin, which better-auth's CSRF check must accept.
    trustedOrigins: process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173'],
  }
}

/** HMAC secret shared by POST /api/webhooks/payment and the in-app payment simulator. */
export const paymentWebhookSecret = () => requireEnv('PAYMENT_WEBHOOK_SECRET')
