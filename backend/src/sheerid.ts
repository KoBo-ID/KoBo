/**
 * SheerID student verification: DEV / TEST ONLY.
 *
 * Legal status (2026-11-18, .orchestration/web-research/all-campus-verification/sheerid-implementation.md):
 * real students' data must not go to SheerID until every go-live gate is green, because:
 * - from 16 Jan 2027 PP 33/2026 Pasal 173 limits consent-based transfers abroad;
 * - SheerID's VSA licenses Results for discount offers only (§3.1(b)), and bars showing them to third parties (§3.2(e)).
 * So sheerIdEnv() refuses NODE_ENV=production outright, the feature is off unless SHEERID_ENABLED=1, and the SheerID
 * program must stay in Test Mode (fake names, SheerID's sample documents).
 *
 * KoBo stores no personal data from SheerID: the student fills SheerID's hosted form, KoBo keeps only the opaque
 * verificationId and the outcome, reads status with a token WITHOUT the Customer PII role, and purges the person's
 * data at SheerID as soon as a final result is known.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { STUDENT_VERIFICATION_MAX_DAYS } from '@kobo/shared/domain'
import type { PrismaClient } from './db/client.ts'
import { applyVerification } from './studentVerification/verifier.ts'

export const SHEERID_CONSENT_VERSION = 'sheerid-dev-2026-11-18'
const API_BASE = 'https://services.sheerid.com/rest/v2'
const AUTH_URL = 'https://auth.sheerid.com/oauth/token'
const FORM_BASE = 'https://services.sheerid.com/verify'
const TIMEOUT_MS = 10_000

export interface SheerIdConfig {
  programId: string
  clientId: string
  clientSecret: string
  /** Secret Token for X-SheerID-Signature; null = webhook route answers 404 (local dev polls instead). */
  webhookSecret: string | null
}

/**
 * Off unless SHEERID_ENABLED=1. Refused in production (see the file header). When enabled, SHEERID_PROGRAM_ID,
 * SHEERID_CLIENT_ID and SHEERID_CLIENT_SECRET are all required; SHEERID_WEBHOOK_SECRET is optional.
 */
export function sheerIdEnv(env: NodeJS.ProcessEnv = process.env): SheerIdConfig | null {
  if (env.SHEERID_ENABLED !== '1') return null
  if (env.NODE_ENV === 'production') {
    throw new Error(
      '[sheerid] SHEERID_ENABLED=1 is refused in production: SheerID is dev/test only until the legal go-live gate in ' +
        '.orchestration/web-research/all-campus-verification/sheerid-implementation.md is green (PP 33/2026 Pasal 173; SheerID VSA §3.1(b), §3.2(e)).',
    )
  }
  const programId = env.SHEERID_PROGRAM_ID?.trim() ?? ''
  const clientId = env.SHEERID_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.SHEERID_CLIENT_SECRET?.trim() ?? ''
  const missing = [!programId && 'SHEERID_PROGRAM_ID', !clientId && 'SHEERID_CLIENT_ID', !clientSecret && 'SHEERID_CLIENT_SECRET'].filter(Boolean)
  if (missing.length > 0) throw new Error(`[sheerid] SHEERID_ENABLED=1 needs ${missing.join(', ')}.`)
  return { programId, clientId, clientSecret, webhookSecret: env.SHEERID_WEBHOOK_SECRET?.trim() || null }
}

export interface SheerIdVerificationState {
  currentStep: string
  errorIds: string[]
}

/** The network edge. Injected so tests never call SheerID. */
export interface SheerIdClient {
  createVerification(): Promise<{ verificationId: string }>
  getVerification(verificationId: string): Promise<SheerIdVerificationState>
  purgePersonData(verificationId: string): Promise<void>
  /** SheerID's hosted form for this verification; the browser is sent here. */
  formUrl(verificationId: string): string
}

export interface SheerIdService {
  client: SheerIdClient
  webhookSecret: string | null
}

export class SheerIdError extends Error {}

type FetchFn = typeof fetch

/** OAuth client-credentials token (30-day lifetime), cached until 5 minutes before expiry. */
export class HttpSheerIdClient implements SheerIdClient {
  private token: { value: string; expiresAt: number } | null = null
  private readonly cfg: SheerIdConfig
  private readonly fetchFn: FetchFn
  private readonly now: () => number

  // Plain fields, not TS parameter properties: Node's strip-only mode rejects those (X-01).
  constructor(cfg: SheerIdConfig, fetchFn: FetchFn = fetch, now: () => number = Date.now) {
    this.cfg = cfg
    this.fetchFn = fetchFn
    this.now = now
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value
    const res = await this.fetchFn(AUTH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', audience: 'https://services.sheerid.com/rest/', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new SheerIdError(`token ${res.status}`)
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown }
    if (typeof body.access_token !== 'string') throw new SheerIdError('token missing')
    const ttl = typeof body.expires_in === 'number' ? body.expires_in : 3600
    this.token = { value: body.access_token, expiresAt: this.now() + Math.max(60, ttl - 300) * 1000 }
    return this.token.value
  }

  private async call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<unknown> {
    const res = await this.fetchFn(`${API_BASE}${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json', accept: 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new SheerIdError(`${init.method} ${path.replace(/[^/]{20,}/g, ':id')} ${res.status}`)
    const text = await res.text()
    return text ? (JSON.parse(text) as unknown) : null
  }

  async createVerification(): Promise<{ verificationId: string }> {
    const body = (await this.call('/verification', { method: 'POST', body: { programId: this.cfg.programId } })) as { verificationId?: unknown } | null
    if (!body || typeof body.verificationId !== 'string') throw new SheerIdError('verificationId missing')
    return { verificationId: body.verificationId }
  }

  async getVerification(verificationId: string): Promise<SheerIdVerificationState> {
    const body = (await this.call(`/verification/${encodeURIComponent(verificationId)}`, { method: 'GET' })) as { currentStep?: unknown; errorIds?: unknown } | null
    return {
      currentStep: typeof body?.currentStep === 'string' ? body.currentStep : 'unknown',
      errorIds: Array.isArray(body?.errorIds) ? body.errorIds.filter((e): e is string => typeof e === 'string') : [],
    }
  }

  async purgePersonData(verificationId: string): Promise<void> {
    await this.call(`/verification/${encodeURIComponent(verificationId)}/purgePersonData`, { method: 'POST' })
  }

  formUrl(verificationId: string): string {
    return `${FORM_BASE}/${encodeURIComponent(this.cfg.programId)}/?verificationId=${encodeURIComponent(verificationId)}`
  }
}

export function sheerIdServiceFromEnv(env: NodeJS.ProcessEnv = process.env): SheerIdService | null {
  const cfg = sheerIdEnv(env)
  return cfg ? { client: new HttpSheerIdClient(cfg), webhookSecret: cfg.webhookSecret } : null
}

/** X-SheerID-Signature = lowercase hex HMAC-SHA256 of the raw body with the Secret Token; compared in constant time. */
export function verifySheerIdSignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex'), 'utf8')
  const given = Buffer.from(header.trim().toLowerCase(), 'utf8')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export type SheerIdOutcome = 'SUCCESS' | 'FAILED' | 'PENDING' | 'UNKNOWN'

export function outcomeOf(step: string): Exclude<SheerIdOutcome, 'UNKNOWN'> {
  if (step === 'success') return 'SUCCESS'
  if (step === 'error' || step === 'consolation') return 'FAILED'
  return 'PENDING'
}

/**
 * Reads the verification at SheerID and records a final result once. Safe to call from the webhook and the
 * return-page refresh at the same time: only the call that flips the row out of PENDING applies the verification.
 * After a final result the person's data at SheerID is purged (best effort; purgedAt stays null on failure).
 */
export async function settleSheerId(prisma: PrismaClient, client: SheerIdClient, verificationId: string, now: Date = new Date()): Promise<SheerIdOutcome> {
  const row = await prisma.sheerIdVerification.findUnique({ where: { verificationId }, select: { id: true, userId: true, campusId: true, status: true, purgedAt: true } })
  if (!row) return 'UNKNOWN'
  if (row.status !== 'PENDING') {
    if (row.purgedAt === null) await purge(prisma, client, row.id, verificationId, now)
    return row.status
  }
  const state = await client.getVerification(verificationId)
  const outcome = outcomeOf(state.currentStep)
  if (outcome === 'PENDING') {
    await prisma.sheerIdVerification.update({ where: { id: row.id }, data: { lastStep: state.currentStep.slice(0, 40) } })
    return 'PENDING'
  }
  const flipped = await prisma.$transaction(async (tx) => {
    const res = await tx.sheerIdVerification.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: outcome, lastStep: state.currentStep.slice(0, 40), errorIds: state.errorIds.slice(0, 10).map((e) => e.slice(0, 60)), decidedAt: now },
    })
    if (res.count !== 1) return false
    if (outcome === 'SUCCESS') {
      const campus = row.campusId ? await tx.campus.findUnique({ where: { id: row.campusId }, select: { id: true, shortName: true } }) : null
      const until = new Date(now.getTime() + STUDENT_VERIFICATION_MAX_DAYS * 86_400_000)
      await applyVerification(tx, row.userId, { via: 'SHEERID', until, campusShortName: campus?.shortName, campusId: campus?.id }, now)
    }
    return true
  })
  if (flipped) await purge(prisma, client, row.id, verificationId, now)
  return outcome
}

async function purge(prisma: PrismaClient, client: SheerIdClient, id: string, verificationId: string, now: Date): Promise<void> {
  try {
    await client.purgePersonData(verificationId)
    await prisma.sheerIdVerification.update({ where: { id }, data: { purgedAt: now } })
  } catch (e) {
    console.warn('[sheerid] purge failed; retried on the next settle', { reason: e instanceof SheerIdError ? e.message : 'error' })
  }
}
