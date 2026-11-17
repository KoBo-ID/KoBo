import { createHmac, timingSafeEqual } from 'node:crypto'

/*
 * Signed, expiring campus-email link tokens: base64url(JSON claim) "." base64url(HMAC-SHA256).
 * The key is derived from the auth secret with a purpose label, so a token minted here can never be
 * replayed against better-auth's own signed values.
 */

export interface CampusClaim {
  userId: string
  email: string
}

export const CAMPUS_TOKEN_TTL_SECONDS = 24 * 3600

const sign = (secret: string, body: string) =>
  createHmac('sha256', createHmac('sha256', secret).update('kobo:campus-email').digest()).update(body).digest('base64url')

export function signCampusToken(secret: string, claim: CampusClaim, ttlSeconds = CAMPUS_TOKEN_TTL_SECONDS): string {
  const body = Buffer.from(JSON.stringify({ u: claim.userId, e: claim.email, x: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url')
  return `${body}.${sign(secret, body)}`
}

/** Returns the claim, or null for a malformed, forged or expired token. */
export function verifyCampusToken(secret: string, token: string): CampusClaim | null {
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return null
  const expected = Buffer.from(sign(secret, body))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const { u, e, x } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { u?: unknown; e?: unknown; x?: unknown }
    if (typeof u !== 'string' || typeof e !== 'string' || typeof x !== 'number') return null
    if (x < Math.floor(Date.now() / 1000)) return null
    return { userId: u, email: e }
  } catch {
    return null
  }
}

/** Domain part of an address, lower-cased, or null if it is not a single `local@domain`. */
export function emailDomain(email: string): string | null {
  const parts = email.split('@')
  return parts.length === 2 && parts[0] && parts[1] ? parts[1].toLowerCase() : null
}

/** Indonesian academic domains end in `.ac.id`; "fake-ac.id" and "x.ac.id.evil.com" do not qualify. */
export const isAcademicDomain = (domain: string) => domain.endsWith('.ac.id') && domain.length > '.ac.id'.length

/** True when `domain` equals a campus domain or is a subdomain of it (student.binus.ac.id under binus.ac.id). */
export const domainMatches = (domain: string, campusDomain: string) => domain === campusDomain || domain.endsWith(`.${campusDomain}`)
