import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { PrismaClient } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import type { NormalizedPaymentEvent } from './provider.ts'
import { applyPaymentEvent } from './settlement.ts'
import type { SettlementOutcome } from './settlement.ts'

export interface XenditWebhookConfig {
  callbackToken: string
  businessId: string
}

export const MAX_WEBHOOK_BYTES = 64 * 1024

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/** Constant-time compare: hashing both sides first makes the lengths equal, so no length leak and no throw. */
export function tokenMatches(given: string | null | undefined, expected: string): boolean {
  if (!given || !expected) return false
  return timingSafeEqual(Buffer.from(sha256(given), 'hex'), Buffer.from(sha256(expected), 'hex'))
}

export const fingerprint = (eventType: string, resourceId: string, updated: string) => sha256(`xendit:${eventType}:${resourceId}:${updated}`)

// Xendit adds fields over time, so objects are never .strict(): unknown keys are stripped, not rejected.
const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)))
const envelope = z.object({ event: z.string().min(1), business_id: z.string().min(1).optional(), created: iso.optional(), data: z.record(z.string(), z.unknown()) })
const sessionData = z.object({
  payment_session_id: z.string().min(1),
  reference_id: z.string().min(1).max(64),
  // amount and currency appear in Xendit's examples but not its schema, so their absence is audited, not a 400.
  amount: z.number().int().nonnegative().optional(),
  currency: z.string().min(1).optional(),
  status: z.string().optional(),
  updated: iso.optional(),
  business_id: z.string().min(1).optional(),
  payment_request_id: z.string().min(1).nullish(),
  latest_payment_request_id: z.string().min(1).nullish(),
  payment_id: z.string().min(1).nullish(),
})
const refundData = z.object({
  id: z.string().min(1),
  reference_id: z.string().min(1).max(255),
  payment_request_id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  status: z.string().optional(),
  failure_code: z.string().nullish(),
  updated: iso.optional(),
})

export type ParsedWebhook =
  | { kind: 'KNOWN'; event: NormalizedPaymentEvent; eventType: string; resourceId: string; updated: string; metadata: Prisma.InputJsonObject }
  | { kind: 'UNKNOWN'; eventType: string }
  | { kind: 'REJECTED'; eventType: string; resourceId: string; reason: string }
  | { kind: 'MALFORMED' }

/** Pure parser: validates one Xendit callback body and normalises it to what KoBo settlement needs. */
export function parseXenditWebhook(json: unknown): ParsedWebhook {
  const env = envelope.safeParse(json)
  if (!env.success) return { kind: 'MALFORMED' }
  const { event: eventType, data } = env.data
  const known = ['payment_session.completed', 'payment_session.expired', 'refund.succeeded', 'refund.failed']
  if (!known.includes(eventType)) return { kind: 'UNKNOWN', eventType }

  const created = env.data.created ?? new Date().toISOString()
  if (eventType.startsWith('payment_session.')) {
    const d = sessionData.safeParse(data)
    const businessId = d.success ? (env.data.business_id ?? d.data.business_id) : undefined
    if (!d.success || !businessId) return { kind: 'MALFORMED' }
    const resourceId = d.data.payment_session_id
    if (d.data.currency !== undefined && d.data.currency !== 'IDR') return { kind: 'REJECTED', eventType, resourceId, reason: 'CURRENCY_MISMATCH' }
    const requestId = d.data.payment_request_id ?? d.data.latest_payment_request_id
    // A completed event that cannot be verified is audited (200) so Xendit stops retrying; the background sweep then
    // asks Xendit for the authoritative session and settles it.
    if (eventType === 'payment_session.completed' && (d.data.amount === undefined || d.data.currency === undefined)) return { kind: 'REJECTED', eventType, resourceId, reason: 'MISSING_AMOUNT' }
    if (eventType === 'payment_session.completed' && (!requestId || !d.data.payment_id)) return { kind: 'REJECTED', eventType, resourceId, reason: 'MISSING_PAYMENT_IDS' }
    const updated = d.data.updated ?? created
    const base = { referenceId: d.data.reference_id, providerBusinessId: businessId, amount: d.data.amount ?? 0, currency: 'IDR' as const, occurredAt: new Date(updated) }
    const metadata = { sessionId: d.data.payment_session_id, paymentRequestId: d.data.payment_request_id ?? null, amount: d.data.amount ?? null, currency: d.data.currency ?? null, businessId, providerStatus: d.data.status ?? null, providerUpdatedAt: updated }
    if (eventType === 'payment_session.expired') {
      return { kind: 'KNOWN', eventType, resourceId: d.data.payment_session_id, updated, metadata, event: { ...base, kind: 'SESSION_EXPIRED', providerSessionId: d.data.payment_session_id } }
    }
    return {
      kind: 'KNOWN',
      eventType,
      resourceId: d.data.payment_session_id,
      updated,
      metadata,
      event: { ...base, kind: 'SESSION_COMPLETED', providerSessionId: d.data.payment_session_id, providerPaymentRequestId: requestId!, providerPaymentId: d.data.payment_id! },
    }
  }

  const d = refundData.safeParse(data)
  const businessId = env.data.business_id
  if (!d.success || !businessId || d.data.currency !== 'IDR') return { kind: 'MALFORMED' }
  const updated = d.data.updated ?? created
  const base = { referenceId: d.data.reference_id, providerBusinessId: businessId, amount: d.data.amount, currency: 'IDR' as const, occurredAt: new Date(updated), providerRefundId: d.data.id, providerPaymentRequestId: d.data.payment_request_id }
  const metadata = { refundId: d.data.id, paymentRequestId: d.data.payment_request_id, amount: d.data.amount, currency: d.data.currency, businessId, providerStatus: d.data.status ?? null, providerUpdatedAt: updated, failureCode: d.data.failure_code ?? null }
  return {
    kind: 'KNOWN',
    eventType,
    resourceId: d.data.id,
    updated,
    metadata,
    event: eventType === 'refund.succeeded' ? { ...base, kind: 'REFUND_SUCCEEDED' } : { ...base, kind: 'REFUND_FAILED', failureCode: d.data.failure_code ?? null },
  }
}

export interface WebhookResponse {
  status: 200 | 400 | 401 | 413 | 500
  body: { ok: boolean; result?: string; error?: string }
}

const resultFor = (outcome: SettlementOutcome) =>
  outcome === 'REJECTED' ? ('REJECTED' as const) : outcome === 'SETTLED' || outcome === 'EXPIRED' || outcome === 'REFUND_QUEUED' || outcome === 'REFUNDED' || outcome === 'REFUND_FAILED' ? ('APPLIED' as const) : ('IGNORED' as const)

/**
 * Authenticate, parse, audit and apply one Xendit callback. The fingerprint row and the domain transition share one
 * transaction: a rollback removes the fingerprint, so the provider's retry is processed again instead of skipped.
 */
export async function handleXenditWebhook(
  prisma: PrismaClient,
  cfg: XenditWebhookConfig,
  input: { rawBody: string; token: string | null | undefined },
  now = new Date(),
): Promise<WebhookResponse> {
  if (!tokenMatches(input.token, cfg.callbackToken)) return { status: 401, body: { ok: false, error: 'Token tidak valid.' } }
  if (Buffer.byteLength(input.rawBody) > MAX_WEBHOOK_BYTES) return { status: 413, body: { ok: false, error: 'Body terlalu besar.' } }
  let json: unknown
  try {
    json = JSON.parse(input.rawBody)
  } catch {
    return { status: 400, body: { ok: false, error: 'Body bukan JSON.' } }
  }

  const parsed = parseXenditWebhook(json)
  if (parsed.kind === 'MALFORMED') return { status: 400, body: { ok: false, error: 'Body tidak valid.' } }
  if (parsed.kind === 'REJECTED') {
    return audit(prisma, { eventType: parsed.eventType, resourceId: parsed.resourceId, fp: sha256(`xendit:${parsed.eventType}:${parsed.resourceId}:${sha256(input.rawBody)}`), result: 'REJECTED', reason: parsed.reason })
  }
  if (parsed.kind === 'UNKNOWN') {
    return audit(prisma, { eventType: parsed.eventType, resourceId: 'unknown', fp: sha256(`xendit:${parsed.eventType}:${sha256(input.rawBody)}`), result: 'IGNORED', reason: 'UNKNOWN_EVENT' })
  }

  const fp = fingerprint(parsed.eventType, parsed.resourceId, parsed.updated)
  try {
    const result = await prisma.$transaction(async (tx) => {
      // ON CONFLICT DO NOTHING: a concurrent duplicate waits for the first transaction and then sees count 0.
      const { count } = await tx.paymentWebhookEvent.createMany({
        data: [{ provider: 'XENDIT', fingerprint: fp, eventType: parsed.eventType, externalResourceId: parsed.resourceId }],
        skipDuplicates: true,
      })
      if (!count) return 'DUPLICATE_DELIVERY'
      const r = await applyPaymentEvent(tx, { provider: 'XENDIT', expectedBusinessId: cfg.businessId, now }, parsed.event)
      await tx.paymentWebhookEvent.update({
        where: { fingerprint: fp },
        data: { result: resultFor(r.outcome), reason: r.reason ?? r.outcome, paymentId: r.paymentId, metadata: parsed.metadata, processedAt: now },
      })
      return r.outcome
    })
    return { status: 200, body: { ok: true, result: result } }
  } catch (e) {
    console.error('[payments] xendit webhook failed', { eventType: parsed.eventType, code: (e as { code?: string }).code ?? 'UNKNOWN' })
    return { status: 500, body: { ok: false, error: 'Gagal memproses callback.' } }
  }
}

async function audit(
  prisma: PrismaClient,
  row: { eventType: string; resourceId: string; fp: string; result: 'IGNORED' | 'REJECTED'; reason: string },
): Promise<WebhookResponse> {
  try {
    await prisma.paymentWebhookEvent.createMany({
      data: [{ provider: 'XENDIT', fingerprint: row.fp, eventType: row.eventType, externalResourceId: row.resourceId, result: row.result, reason: row.reason, processedAt: new Date() }],
      skipDuplicates: true,
    })
    return { status: 200, body: { ok: true, result: row.result } }
  } catch {
    return { status: 500, body: { ok: false, error: 'Gagal memproses callback.' } }
  }
}
