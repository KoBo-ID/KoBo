import type { PrismaClient } from './db/client.ts'
import { renderEmail } from './emailTemplates.ts'
import { startPeriodic, type StopWorker } from './worker.ts'

/*
 * Transactional email outbox (spec section 8). Business code writes a row with enqueueEmail(); the
 * worker started in index.ts calls drainOutbox() every 15 s. Nothing here sends mail inline.
 */

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  /** Stable per outbox row: lets the provider drop a duplicate send of the same row (Resend keeps keys for 24 h). */
  idempotencyKey?: string
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>
}

export const MAX_ATTEMPTS = 5
/** A claimed row is invisible to other drains for this long. A worker that dies mid-send is retried after it. */
const LEASE_SECONDS = 150
/** Rows per claim. Worst case a batch lasts BATCH_SIZE x the 15 s send timeout (120 s), which must stay under LEASE_SECONDS. */
const DEFAULT_BATCH_SIZE = 8
const BACKOFF_BASE_SECONDS = 30
const BACKOFF_CAP_SECONDS = 3600

/** Seconds to wait before attempt `attempts + 1`: 30 s, 1 min, 2 min, 4 min, ... capped at 1 h. */
export const backoffSeconds = (attempts: number) => Math.min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attempts - 1))

export function enqueueEmail(
  db: Pick<PrismaClient, 'emailOutbox'>,
  email: { to: string; template: string; payload: Record<string, string | number> },
) {
  return db.emailOutbox.create({ data: { to: email.to, template: email.template, payload: email.payload } })
}

interface ClaimedRow {
  id: string
  to: string
  template: string
  payload: unknown
  attempts: number
}

export interface DrainResult {
  claimed: number
  sent: number
  failed: number
}

/**
 * Claim up to `batchSize` due rows and send them.
 *
 * The claim is one UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED): concurrent drains (two
 * containers overlapping during a rollback, or a slow tick overlapping the next) never see the same row.
 * Claiming bumps `attempts` and pushes `nextAttemptAt` out by the lease, so a crash mid-send retries later
 * instead of losing or double-sending the row.
 */
export async function drainOutbox(prisma: PrismaClient, transport: EmailTransport, opts: { batchSize?: number } = {}): Promise<DrainResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
  const rows = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "EmailOutbox"
    SET attempts = attempts + 1,
        "nextAttemptAt" = now() + (${LEASE_SECONDS}::int * interval '1 second')
    WHERE id IN (
      SELECT id FROM "EmailOutbox"
      WHERE status = 'PENDING'::"OutboxStatus" AND "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt", id
      LIMIT ${batchSize}::int
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "to", template, payload, attempts`

  const result: DrainResult = { claimed: rows.length, sent: 0, failed: 0 }
  for (const row of rows) {
    const rendered = renderEmail(row.template, row.payload)
    if (!rendered) {
      // A template we cannot render never will; retrying would only loop.
      await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'FAILED' } })
      console.error(`[outbox] ${row.id}: unknown template or bad payload "${row.template}"`)
      result.failed++
      continue
    }
    try {
      await transport.send({ to: row.to, ...rendered, idempotencyKey: row.id })
      // Conditional: never move a row another worker already finished back to a retry state.
      await prisma.emailOutbox.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'SENT', sentAt: new Date() } })
      result.sent++
    } catch (err) {
      result.failed++
      const giveUp = row.attempts >= MAX_ATTEMPTS
      // Recipient domain only (no full address in logs); the error carries Resend's status and body.
      const domain = row.to.split('@')[1] ?? '?'
      console.error(
        `[outbox] ${row.id}: ${row.template} to *@${domain} failed (attempt ${row.attempts}/${MAX_ATTEMPTS})${giveUp ? ', giving up: status FAILED' : ''}:`,
        err instanceof Error ? err.message : err,
      )
      await prisma.emailOutbox.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: giveUp ? { status: 'FAILED' } : { nextAttemptAt: new Date(Date.now() + backoffSeconds(row.attempts) * 1000) },
      })
    }
  }
  return result
}

/** Production transport: Resend's HTTP API. */
export function resendTransport(opts: { apiKey: string; from: string; replyTo?: string; fetch?: typeof fetch }): EmailTransport {
  const doFetch = opts.fetch ?? fetch
  return {
    async send(message) {
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from: opts.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new ResendError(res.status, (await res.text()).slice(0, 500))
    },
  }
}

/** A non-2xx answer from Resend. The body is Resend's JSON error (name + message), never our key. */
export class ResendError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, body: string) {
    super(`Resend responded ${status}: ${body}`)
    this.name = 'ResendError'
    this.status = status
    this.body = body
  }
}

/** Dev / demo fallback: print the message (and so the link) instead of sending it. */
export function consoleTransport(log: (line: string) => void = console.log): EmailTransport {
  return {
    async send(message) {
      log(`[email] to=${message.to} subject="${message.subject}"\n${message.text}\n`)
    },
  }
}

/** onboarding@resend.dev and friends: Resend's shared test sender. */
export const isResendTestSender = (from: string) => /@resend\.dev>?\s*$/i.test(from.trim())

export function transportFromEnv(env: NodeJS.ProcessEnv = process.env, warn: (line: string) => void = console.warn): EmailTransport {
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === 'production') {
      // Verification and reset links are bearer tokens: printing them is never an acceptable production substitute for sending them.
      if (env.ALLOW_CONSOLE_EMAIL !== '1') {
        throw new Error('[email] RESEND_API_KEY is not set in production: verification and reset links would only be printed to the log. Set RESEND_API_KEY and EMAIL_FROM (ALLOW_CONSOLE_EMAIL=1 is for e2e and demo only).')
      }
      warn('[email] RESEND_API_KEY is not set (ALLOW_CONSOLE_EMAIL=1): emails are only printed to the log, nobody receives them.')
    }
    return consoleTransport()
  }
  if (!env.EMAIL_FROM) throw new Error('EMAIL_FROM is required when RESEND_API_KEY is set')
  if (env.NODE_ENV === 'production' && isResendTestSender(env.EMAIL_FROM)) {
    warn(
      `[email] EMAIL_FROM="${env.EMAIL_FROM}" is Resend's shared test sender. It delivers only to the Resend account owner ` +
        '(everyone else gets 403 and the outbox row ends FAILED) and lands in spam. Verify your own domain in Resend and use an address on it.',
    )
  }
  return resendTransport({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, replyTo: env.EMAIL_REPLY_TO?.trim() || undefined })
}

/** Start the periodic drain. Ticks never overlap within this process. Returns a stop function. */
export function startOutboxWorker(prisma: PrismaClient, transport: EmailTransport, intervalMs = 15_000): StopWorker {
  return startPeriodic('outbox', intervalMs, () => drainOutbox(prisma, transport))
}
