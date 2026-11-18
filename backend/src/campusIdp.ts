// Campus identity provider port (Microsoft Entra / Google Workspace OIDC) and its implementation.
import { createHash, createPublicKey, verify as cryptoVerify, type JsonWebKey as NodeJwk } from 'node:crypto'

export type CampusIdpProvider = 'microsoft' | 'google'

/** Verified ID token claims. Never the `email` claim: identity is tid+oid (Microsoft) or hd+sub (Google). */
export type IdClaims = { provider: 'microsoft'; tid: string; oid: string; iss: string } | { provider: 'google'; sub: string; hd: string }

export interface CampusIdp {
  authorizationUrl(input: { provider: CampusIdpProvider; state: string; nonce: string; codeVerifier: string; redirectUri: string }): Promise<string>
  exchange(input: { provider: CampusIdpProvider; code: string; codeVerifier: string; redirectUri: string }): Promise<{ idToken: string }>
  verifyIdToken(input: { provider: CampusIdpProvider; idToken: string; nonce: string }): Promise<IdClaims>
}

/*
 * Real implementation: Microsoft Entra (multi-tenant "organizations" authority) and Google Workspace, Authorization Code + PKCE.
 * No dependency: the ID token signature is checked with node:crypto against the provider's JWKS (RS256 only), and the
 * claims by the pure validateClaims(). Identity is tid+oid / hd+sub, NEVER the email or preferred_username claim.
 * A campus ID token proves "this person holds an account in tenant X"; it is never used to log in or to create an Account row.
 */

/** The Microsoft consumer (personal account) tenant. Anyone can have one, so it proves nothing about a campus. */
export const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

const MS_AUTHORITY = 'https://login.microsoftonline.com/organizations'
const ENDPOINTS = {
  microsoft: {
    authorize: `${MS_AUTHORITY}/oauth2/v2.0/authorize`,
    token: `${MS_AUTHORITY}/oauth2/v2.0/token`,
    jwks: `${MS_AUTHORITY}/discovery/v2.0/keys`,
    // Only the identity claims we need: no email, no profile.
    scope: 'openid',
  },
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    scope: 'openid email', // `email` makes Google include `hd`; the email value itself is never read.
  },
} as const

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

export class CampusIdpError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`campus idp: ${reason}`)
    this.reason = reason
  }
}

export interface ClaimContext {
  clientId: string
  nonce: string
  now: Date
}

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)

/** Pure claim validation after the signature has been verified. Throws CampusIdpError. Never reads email / preferred_username. */
export function validateClaims(provider: CampusIdpProvider, payload: Record<string, unknown>, ctx: ClaimContext): IdClaims {
  const aud = payload.aud
  if (!(aud === ctx.clientId || (Array.isArray(aud) && aud.includes(ctx.clientId)))) throw new CampusIdpError('aud')
  const exp = payload.exp
  if (typeof exp !== 'number' || exp <= Math.floor(ctx.now.getTime() / 1000)) throw new CampusIdpError('expired')
  if (str(payload.nonce) !== ctx.nonce) throw new CampusIdpError('nonce')
  const iss = str(payload.iss)

  if (provider === 'microsoft') {
    const tid = str(payload.tid)
    const oid = str(payload.oid)
    if (!tid || !oid) throw new CampusIdpError('missing tid/oid')
    if (iss !== `https://login.microsoftonline.com/${tid}/v2.0`) throw new CampusIdpError('iss')
    if (tid.toLowerCase() === MICROSOFT_CONSUMER_TENANT) throw new CampusIdpError('consumer tenant')
    return { provider: 'microsoft', tid: tid.toLowerCase(), oid, iss }
  }

  if (!iss || !GOOGLE_ISSUERS.has(iss)) throw new CampusIdpError('iss')
  const sub = str(payload.sub)
  const hd = str(payload.hd)
  if (!sub) throw new CampusIdpError('missing sub')
  if (!hd) throw new CampusIdpError('missing hd')
  return { provider: 'google', sub, hd: hd.toLowerCase() }
}

export type JwksFetcher = (provider: CampusIdpProvider) => Promise<NodeJwk[]>

export interface CampusIdpConfig {
  microsoft?: { clientId: string; clientSecret: string } | null
  google?: { clientId: string; clientSecret: string } | null
  /** Injectable for tests. Default: fetch the provider's JWKS, cached 1 h (refetched once on an unknown kid). */
  jwks?: JwksFetcher
  fetch?: typeof fetch
  now?: () => Date
}

const b64json = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString()) as Record<string, unknown>

export function createCampusIdp(config: CampusIdpConfig): CampusIdp {
  const doFetch = config.fetch ?? fetch
  const now = config.now ?? (() => new Date())
  const creds = (provider: CampusIdpProvider) => {
    const c = config[provider]
    if (!c) throw new CampusIdpError('provider not configured')
    return c
  }

  const cache = new Map<CampusIdpProvider, { keys: NodeJwk[]; at: number }>()
  const jwks: JwksFetcher =
    config.jwks ??
    (async (provider) => {
      const hit = cache.get(provider)
      if (hit && Date.now() - hit.at < 3_600_000) return hit.keys
      const res = await doFetch(ENDPOINTS[provider].jwks, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) throw new CampusIdpError(`jwks ${res.status}`)
      const keys = ((await res.json()) as { keys?: NodeJwk[] }).keys ?? []
      cache.set(provider, { keys, at: Date.now() })
      return keys
    })

  return {
    async authorizationUrl({ provider, state, nonce, codeVerifier, redirectUri }) {
      const e = ENDPOINTS[provider]
      const url = new URL(e.authorize)
      const q = url.searchParams
      q.set('client_id', creds(provider).clientId)
      q.set('response_type', 'code')
      q.set('redirect_uri', redirectUri)
      q.set('scope', e.scope)
      q.set('state', state)
      q.set('nonce', nonce)
      q.set('code_challenge', createHash('sha256').update(codeVerifier).digest('base64url'))
      q.set('code_challenge_method', 'S256')
      q.set('prompt', 'select_account')
      if (provider === 'microsoft') q.set('response_mode', 'query')
      return url.toString()
    },

    async exchange({ provider, code, codeVerifier, redirectUri }) {
      const c = creds(provider)
      const res = await doFetch(ENDPOINTS[provider].token, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: c.clientId, client_secret: c.clientSecret, code_verifier: codeVerifier }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new CampusIdpError(`token ${res.status}`)
      const idToken = str(((await res.json()) as { id_token?: unknown }).id_token)
      if (!idToken) throw new CampusIdpError('no id_token')
      return { idToken }
    },

    async verifyIdToken({ provider, idToken, nonce }) {
      const c = creds(provider)
      const parts = idToken.split('.')
      if (parts.length !== 3) throw new CampusIdpError('malformed')
      const [h, p, s] = parts as [string, string, string]
      let header: Record<string, unknown>
      let payload: Record<string, unknown>
      try {
        header = b64json(h)
        payload = b64json(p)
      } catch {
        throw new CampusIdpError('malformed')
      }
      if (header.alg !== 'RS256') throw new CampusIdpError('alg')
      const jwk = (await jwks(provider)).find((k) => (k as { kid?: string }).kid === header.kid)
      if (!jwk) throw new CampusIdpError('unknown kid')
      const ok = cryptoVerify('sha256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'))
      if (!ok) throw new CampusIdpError('signature')
      return validateClaims(provider, payload, { clientId: c.clientId, nonce, now: now() })
    },
  }
}
