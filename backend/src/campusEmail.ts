import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { resolveMx } from 'node:dns/promises'

/*
 * Campus-email verification helpers.
 *  - Code only, no emailed link: mail scanners open links, which would verify an address with no human involved.
 *  - The 6-digit code is stored only as an HMAC, keyed from the auth secret with a purpose label, so a value minted here can
 *    never be replayed against better-auth's own signed values.
 *  - Single use, the 10 minute lifetime and the attempt limit are enforced by the challenge row.
 */

export const CAMPUS_CHALLENGE_TTL_SECONDS = 10 * 60
export const CAMPUS_CODE_MAX_ATTEMPTS = 5

const keyFor = (secret: string, purpose: string) => createHmac('sha256', secret).update(purpose).digest()
/** Uniformly random 6-digit code, leading zeros kept. */
export const generateCampusCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

/** HMAC of the code, bound to its challenge id so a hash cannot be moved between rows. */
export const hashCampusCode = (secret: string, challengeId: string, code: string) =>
  createHmac('sha256', keyFor(secret, 'kobo:campus-code')).update(`${challengeId}:${code}`).digest('hex')

export function codeMatches(secret: string, challengeId: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashCampusCode(secret, challengeId, code))
  const b = Buffer.from(storedHash)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Domain part of an address, lower-cased, or null if it is not a single `local@domain`. */
export function emailDomain(email: string): string | null {
  const parts = email.split('@')
  return parts.length === 2 && parts[0] && parts[1] ? parts[1].toLowerCase() : null
}

/** Exact (lower-cased) match against a curated Campus.studentEmailDomains list. No .ac.id wildcard, no subdomain wildcard. */
export function campusForDomain<T extends { studentEmailDomains: string[] }>(domain: string, campuses: T[]): T | undefined {
  const d = domain.toLowerCase()
  return campuses.find((c) => c.studentEmailDomains.some((x) => x.toLowerCase() === d))
}

/** True when the domain can receive mail. */
export type CampusMxResolver = (domain: string) => Promise<boolean>

const MX_TIMEOUT_MS = 3000

/** Real DNS MX lookup, 3 s timeout. NXDOMAIN, no records and timeout all mean "cannot receive mail". */
export const dnsMxResolver: CampusMxResolver = async (domain) => {
  let timer: NodeJS.Timeout | undefined
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('mx timeout')), MX_TIMEOUT_MS)
      }),
    ])
    return records.length > 0
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Tests and the e2e server never touch the network: the fake accepts every domain the curated-list check already passed. */
export const fakeMxResolver: CampusMxResolver = async () => true

export const defaultMxResolver = (): CampusMxResolver =>
  process.env.NODE_ENV === 'test' || process.env.ALLOW_E2E_HOOKS === '1' ? fakeMxResolver : dnsMxResolver
