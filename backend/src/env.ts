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

const MIN_AUTH_SECRET_LENGTH = 32
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

  const secret = requireEnv('BETTER_AUTH_SECRET', env)
  if (production && secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(`[auth] BETTER_AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters in production (generate one with: openssl rand -base64 32).`)
  }

  const ipHeaders = parseList(env.AUTH_IP_HEADERS).map((h) => h.toLowerCase())
  const google = googleEnv(env)
  const campusMs = campusMsEnv(env)

  return {
    baseURL,
    secret,
    // Dev: the Vite dev server proxies /api but keeps its own Origin, which better-auth's CSRF check must accept.
    // TRUSTED_ORIGINS adds more (e.g. Vercel preview domains) in any environment.
    trustedOrigins: [...new Set([...(production ? [] : ['http://localhost:5173']), ...parseList(env.TRUSTED_ORIGINS).map((o) => o.replace(/\/+$/, ''))])],
    // Unset: createAuth's default (cf-connecting-ip in production). Behind Vercel -> Railway use x-forwarded-for.
    ipAddressHeaders: ipHeaders.length > 0 ? ipHeaders : undefined,
    // Optional Google sign-in; throws when only one of the two variables is set, so a half-configured deploy fails at boot.
    google: google ?? undefined,
    // Campus-account verification (OIDC). Microsoft has its own app registration; Google reuses the sign-in client.
    campusMs: campusMs ?? undefined,
    campusIdpProviders: { microsoft: campusMs !== null, google: google !== null },
  }
}

/**
 * Google sign-in is optional. Both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set -> enabled; neither -> off (null);
 * exactly one -> refuse to start, because that is always a half-finished deployment.
 */
export function googleEnv(env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret: string } | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
  if (!clientId && !clientSecret) return null
  if (!clientId || !clientSecret) {
    throw new Error(`[auth] Google sign-in needs both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; only ${clientId ? 'GOOGLE_CLIENT_ID' : 'GOOGLE_CLIENT_SECRET'} is set.`)
  }
  return { clientId, clientSecret }
}

/**
 * Microsoft campus-account verification is optional, with its own multi-tenant Entra app. Both CAMPUS_MS_CLIENT_ID and
 * CAMPUS_MS_CLIENT_SECRET -> enabled; neither -> off (null); exactly one -> refuse to start.
 */
export function campusMsEnv(env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret: string } | null {
  const clientId = env.CAMPUS_MS_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.CAMPUS_MS_CLIENT_SECRET?.trim() ?? ''
  if (!clientId && !clientSecret) return null
  if (!clientId || !clientSecret) {
    throw new Error(`[auth] Microsoft campus verification needs both CAMPUS_MS_CLIENT_ID and CAMPUS_MS_CLIENT_SECRET; only ${clientId ? 'CAMPUS_MS_CLIENT_ID' : 'CAMPUS_MS_CLIENT_SECRET'} is set.`)
  }
  return { clientId, clientSecret }
}

type XenditBaseConfig = {
  mode: 'test' | 'live'
  apiBaseUrl: string
}

export type PaymentConfig =
  | {
      provider: 'mock'
      xendit: XenditBaseConfig
    }
  | {
      provider: 'xendit'
      xendit: XenditBaseConfig & {
        secretApiKey: string
        callbackToken: string
        businessId: string
      }
    }

const requireTrimmedEnv = (name: string, env: NodeJS.ProcessEnv): string => {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Missing required env var ${name}`)
  return value
}

/*
 * Keep this separate from the auth configuration: a production deployment may deliberately run with payments
 * unavailable, but it must opt into that test-only state rather than silently accepting mock money.
 */
const oneOf = <T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T => {
  const resolved = value === undefined ? fallback : value.trim().toLowerCase()
  if (!allowed.includes(resolved as T)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`)
  return resolved as T
}

/** Payment configuration is deliberately safe-by-default: an unset provider can only create mock attempts. */
export function paymentEnv(env: NodeJS.ProcessEnv = process.env): PaymentConfig {
  const provider = oneOf('PAYMENT_PROVIDER', env.PAYMENT_PROVIDER, ['mock', 'xendit'] as const, 'mock')
  const mode = oneOf('XENDIT_MODE', env.XENDIT_MODE, ['test', 'live'] as const, 'test')
  const customApiBaseUrl = env.XENDIT_API_BASE_URL?.trim()
  if (customApiBaseUrl && env.NODE_ENV !== 'test') throw new Error('XENDIT_API_BASE_URL may only be overridden when NODE_ENV=test')

  const returnOrigin = env.PAYMENT_RETURN_ORIGIN?.trim()
  const fallbackOrigin = env.BETTER_AUTH_URL?.trim()
  if (provider === 'xendit' && (returnOrigin || fallbackOrigin)) {
    let origin: URL | null = null
    try {
      origin = new URL(returnOrigin || fallbackOrigin!)
    } catch {
      /* reported below */
    }
    if (!origin || origin.protocol !== 'https:') {
      throw new Error(
        returnOrigin
          ? 'PAYMENT_RETURN_ORIGIN must be an https origin (Xendit rejects other return URLs)'
          : 'PAYMENT_RETURN_ORIGIN must be set to an https origin when BETTER_AUTH_URL is not https (Xendit rejects other return URLs)',
      )
    }
  }

  const apiBaseUrl = (customApiBaseUrl || 'https://api.xendit.co').replace(/\/+$/, '')
  let parsedApiBaseUrl: URL
  try {
    parsedApiBaseUrl = new URL(apiBaseUrl)
  } catch {
    throw new Error('XENDIT_API_BASE_URL must be an absolute http(s) URL')
  }
  if (!['http:', 'https:'].includes(parsedApiBaseUrl.protocol)) throw new Error('XENDIT_API_BASE_URL must be an absolute http(s) URL')
  if (customApiBaseUrl && !LOCAL_HOSTS.has(parsedApiBaseUrl.hostname)) throw new Error('XENDIT_API_BASE_URL override must use a loopback host')
  if (mode === 'live' && env.ENABLE_XENDIT_LIVE !== '1') throw new Error('XENDIT_MODE=live requires ENABLE_XENDIT_LIVE=1')
  if (provider === 'mock' && env.NODE_ENV === 'production' && env.ALLOW_MOCK_PAYMENTS !== '1') {
    throw new Error('PAYMENT_PROVIDER=mock in production requires ALLOW_MOCK_PAYMENTS=1 (test/e2e only)')
  }

  const xendit: XenditBaseConfig = { mode, apiBaseUrl }
  if (provider === 'xendit') {
    const expectedPrefix = mode === 'test' ? 'xnd_development_' : 'xnd_production_'
    const secretApiKey = requireTrimmedEnv('XENDIT_SECRET_API_KEY', env)
    const callbackToken = requireTrimmedEnv('XENDIT_CALLBACK_TOKEN', env)
    const businessId = requireTrimmedEnv('XENDIT_BUSINESS_ID', env)
    if (!secretApiKey.startsWith(expectedPrefix)) {
      throw new Error(`XENDIT_SECRET_API_KEY must start with ${expectedPrefix} when XENDIT_MODE=${mode}`)
    }
    return { provider, xendit: { ...xendit, secretApiKey, callbackToken, businessId } }
  }
  return { provider, xendit }
}

function autoReviewSeconds(name: string, raw: string | undefined): number | null {
  const v = raw?.trim()
  if (!v) return null
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number of seconds (or unset)`)
  return n
}

/** OWNER_AUTO_REVIEW_SECONDS (demo only): approve owner documents after N seconds. Unset or empty = off; anything else must be a positive integer. */
export function ownerAutoReviewSeconds(env: NodeJS.ProcessEnv = process.env): number | null {
  return autoReviewSeconds('OWNER_AUTO_REVIEW_SECONDS', env.OWNER_AUTO_REVIEW_SECONDS)
}

/** KTM_AUTO_REVIEW_SECONDS (demo only): approve pending KTM photos after N seconds. Same rules as the owner variable. */
export function ktmAutoReviewSeconds(env: NodeJS.ProcessEnv = process.env): number | null {
  return autoReviewSeconds('KTM_AUTO_REVIEW_SECONDS', env.KTM_AUTO_REVIEW_SECONDS)
}

/**
 * Test/e2e hooks (backend/src/e2eHooks.ts): extra /api/__e2e/* routes and a network-free fake Xendit provider.
 * Off unless ALLOW_E2E_HOOKS=1, and then refused unless every guard holds, so a stray flag cannot reach a real deployment.
 */
export function e2eHooksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ALLOW_E2E_HOOKS !== '1') return false
  if (paymentEnv(env).provider !== 'mock') throw new Error('ALLOW_E2E_HOOKS=1 requires PAYMENT_PROVIDER=mock (test/e2e only)')
  // Mirrors ALLOW_MOCK_PAYMENTS: production mode must opt in twice.
  if (env.NODE_ENV === 'production' && env.ALLOW_MOCK_PAYMENTS !== '1') {
    throw new Error('ALLOW_E2E_HOOKS=1 in production requires ALLOW_MOCK_PAYMENTS=1 (e2e only)')
  }
  const host = new URL(requireEnv('DATABASE_URL', env)).hostname
  if (!LOCAL_HOSTS.has(host)) throw new Error('ALLOW_E2E_HOOKS=1 requires a loopback DATABASE_URL')
  return true
}
