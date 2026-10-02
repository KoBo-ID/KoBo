import { createHmac, timingSafeEqual } from 'node:crypto'
import { addMonths, todayWIB } from '@kobo/shared/domain'
import { paymentEventSchema } from '@kobo/shared/schemas'
import type { PaymentEvent } from '@kobo/shared/schemas'
import type { PrismaClient } from './db/client.ts'
import { enqueueEmail } from './outbox.ts'
import type { Prisma } from './generated/prisma/client.ts'

/*
 * Payment settlement (spec section 6). ONE code path credits money: handlePaymentWebhook(). The HTTP route and the
 * in-app simulator both call it, so what the simulator proves is what a real gateway would trigger.
 * Owner "Tandai Lunas" uses settleInvoice() directly, inside its own transaction.
 */

type Tx = Prisma.TransactionClient

export const hmacHex = (rawBody: string, secret: string) => createHmac('sha256', secret).update(rawBody).digest('hex')

/** Constant-time comparison of the hex digest. A wrong-length or non-hex signature is simply false. */
export function verifySignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature) return false
  const expected = Buffer.from(hmacHex(rawBody, secret), 'hex')
  const given = Buffer.from(signature.trim(), 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export interface WebhookResult {
  status: 200 | 400 | 401 | 404
  body: { ok: boolean; result?: 'applied' | 'noop'; error?: string }
}

/** Verify, parse and apply one payment event. `rawBody` must be the exact bytes that were signed. */
export async function handlePaymentWebhook(prisma: PrismaClient, input: { rawBody: string; signature: string | null | undefined; secret: string }): Promise<WebhookResult> {
  if (!verifySignature(input.rawBody, input.signature, input.secret)) return { status: 401, body: { ok: false, error: 'Signature tidak valid.' } }
  let json: unknown
  try {
    json = JSON.parse(input.rawBody)
  } catch {
    return { status: 400, body: { ok: false, error: 'Body bukan JSON.' } }
  }
  const parsed = paymentEventSchema.safeParse(json)
  if (!parsed.success) return { status: 400, body: { ok: false, error: 'Body tidak valid.' } }
  const result = await applyPaymentEvent(prisma, parsed.data)
  return result === 'unknown' ? { status: 404, body: { ok: false, error: 'Pembayaran tidak ditemukan.' } } : { status: 200, body: { ok: true, result } }
}

/** Idempotent on externalId: the payment row is locked, so concurrent deliveries serialise and the loser is a no-op. */
export async function applyPaymentEvent(prisma: PrismaClient, event: PaymentEvent, now = new Date()): Promise<'applied' | 'noop' | 'unknown'> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; status: string; invoiceId: string }[]>`
      SELECT id, status::text AS status, "invoiceId" FROM "Payment" WHERE "externalId" = ${event.externalId} FOR UPDATE`
    const payment = rows[0]
    if (!payment) return 'unknown'
    // PAID: already credited. FAILED: superseded (e.g. the owner recorded a manual payment instead).
    if (payment.status !== 'PENDING') return 'noop'
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID', paidAt: now } })
    await settleInvoice(tx, payment.invoiceId, payment.id)
    return 'applied'
  })
}

/**
 * Mark the invoice PAID and, when it is invoice #1 of a PENDING tenancy, activate that tenancy: room OCCUPIED,
 * invoices #2..N created, "pembayaran diterima" email queued. Must run inside the caller's transaction and
 * after the caller has locked the row that guards against a second settlement.
 */
export async function settleInvoice(tx: Tx, invoiceId: string, paymentId: string): Promise<void> {
  const invoice = await tx.invoice.update({
    where: { id: invoiceId },
    data: { status: 'PAID' },
    include: { tenancy: { include: { room: true, user: { select: { name: true, email: true } }, invoices: { select: { id: true } } } } },
  })
  const { tenancy } = invoice
  // Invoice #1 is the only invoice a PENDING tenancy has. An ENDED tenancy (hold lost to someone else) is left alone.
  if (tenancy.status !== 'PENDING' || tenancy.invoices.length !== 1) return

  await tx.tenancy.update({ where: { id: tenancy.id }, data: { status: 'ACTIVE', expiresAt: null } })
  await tx.room.update({ where: { id: tenancy.roomId }, data: { occupancy: 'OCCUPIED' } })
  const first = todayWIB(tenancy.startDate)
  const later = Array.from({ length: tenancy.durationMonths - 1 }, (_, i) => {
    const due = new Date(`${addMonths(first, i + 1)}T00:00:00Z`)
    return { tenancyId: tenancy.id, periodStart: due, dueDate: due, amount: tenancy.room.priceMonthly }
  })
  if (later.length) await tx.invoice.createMany({ data: later })

  const { receiptNo } = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { receiptNo: true } })
  const origin = (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
  await enqueueEmail(tx, {
    to: tenancy.user.email,
    template: 'payment-received',
    payload: { name: tenancy.user.name, url: `${origin}/kuitansi/${receiptNo}` },
  })
}

/** Fake but stable payment instructions derived from the externalId (no gateway exists). */
export function mockInstructions(externalId: string) {
  const digits = (salt: string, n: number) => {
    const h = createHmac('sha256', salt).update(externalId).digest()
    return Array.from(h, (b) => b % 10).join('').slice(0, n)
  }
  return {
    bcaVa: `39358${digits('bca', 11)}`,
    mandiriVa: `88608${digits('mandiri', 11)}`,
    qris: `00020101021226KOBO${externalId}`,
  }
}
