import { TRPCError } from '@trpc/server'
import { authEnv } from '../env.ts'
import { Prisma, type PrismaClient } from '../generated/prisma/client.ts'
import type { PaymentProvider } from './provider.ts'
import { MIN_XENDIT_CHECKOUT_WINDOW_MS, XenditError } from './xendit.ts'

const SESSION_MAX_MS = 30 * 60 * 1000
const MIN_MOCK_WINDOW_MS = 5 * 60 * 1000
/** A CREATING row older than this lost its provider call (crash/timeout); it is failed before a new attempt opens. */
const CREATING_STALE_MS = 2 * 60 * 1000
const ONLINE: ('MOCK' | 'XENDIT')[] = ['MOCK', 'XENDIT']
const LIVE: ('CREATING' | 'PENDING')[] = ['CREATING', 'PENDING']

export type StartPaymentResult =
  | { kind: 'REDIRECT'; paymentId: string; checkoutUrl: string; expiresAt: Date }
  | { kind: 'DEMO'; paymentId: string; expiresAt: Date }
  | { kind: 'PROCESSING'; paymentId: string }

const liveSelect = { id: true, provider: true, status: true, checkoutUrl: true, expiresAt: true } as const
type LiveAttempt = Prisma.PaymentGetPayload<{ select: typeof liveSelect }>

function resultFor(p: LiveAttempt): StartPaymentResult {
  if (p.status === 'PENDING' && p.provider === 'XENDIT' && p.checkoutUrl && p.expiresAt) {
    return { kind: 'REDIRECT', paymentId: p.id, checkoutUrl: p.checkoutUrl, expiresAt: p.expiresAt }
  }
  if (p.status === 'PENDING' && p.provider === 'MOCK' && p.expiresAt) return { kind: 'DEMO', paymentId: p.id, expiresAt: p.expiresAt }
  return { kind: 'PROCESSING', paymentId: p.id }
}

function returnUrls(paymentId: string) {
  const origin = process.env.PAYMENT_RETURN_ORIGIN?.trim().replace(/\/+$/, '') || authEnv().baseURL
  const base = `${origin}/my-kos?payment=${encodeURIComponent(paymentId)}`
  return { successReturnUrl: `${base}&result=success`, failureReturnUrl: `${base}&result=cancel` }
}

/** Closes attempts that can no longer complete: lapsed sessions and CREATING rows whose provider call was lost. */
export async function expireStaleAttempts(tx: Prisma.TransactionClient, invoiceId: string, now: Date): Promise<void> {
  await tx.payment.updateMany({ where: { invoiceId, provider: { in: ONLINE }, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } })
  await tx.payment.updateMany({
    where: { invoiceId, provider: { in: ONLINE }, status: 'CREATING', createdAt: { lte: new Date(now.getTime() - CREATING_STALE_MS) } },
    data: { status: 'FAILED', failureCode: 'STALE_CREATING' },
  })
}

/** A live attempt is CREATING/PENDING and not past its expiry; a null expiry counts as live. */
export const hasLiveAttempt = (tx: Prisma.TransactionClient, invoiceId: string, now: Date) =>
  tx.payment.findFirst({
    where: { invoiceId, provider: { in: ONLINE }, status: { in: LIVE }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { id: true },
  })

type Phase1 = { existing: LiveAttempt } | { created: { id: string; amount: number; expiresAt: Date } }

/**
 * Opens (or reuses) the single live online attempt for an invoice. Phase 1 decides under the invoice row lock (the same
 * lock recordManual takes); phase 2 calls the provider outside any transaction, so a slow gateway never holds a lock.
 */
export async function startPaymentAttempt(
  prisma: PrismaClient,
  provider: PaymentProvider,
  userId: string,
  invoiceId: string,
  now = new Date(),
): Promise<StartPaymentResult> {
  // A margin over the provider's own check, which uses a later clock reading.
  const minWindow = provider.kind === 'XENDIT' ? MIN_XENDIT_CHECKOUT_WINDOW_MS + 30_000 : MIN_MOCK_WINDOW_MS
  const liveWhere = { invoiceId, provider: { in: ONLINE }, status: { in: LIVE } }

  let phase1: Phase1
  try {
    phase1 = await prisma.$transaction(async (tx): Promise<Phase1> => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, tenancy: { userId } }, include: { tenancy: true } })
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tagihan tidak ditemukan.' })
      if (invoice.status === 'PAID') throw new TRPCError({ code: 'CONFLICT', message: 'Tagihan ini sudah lunas.' })

      await expireStaleAttempts(tx, invoiceId, now)

      const { tenancy } = invoice
      if (tenancy.status === 'ENDED' || (tenancy.status === 'PENDING' && (!tenancy.expiresAt || tenancy.expiresAt <= now))) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Masa tahan kamar sudah berakhir. Ajukan sewa kembali.' })
      }

      const existing = await tx.payment.findFirst({ where: liveWhere, select: liveSelect })
      if (existing) return { existing }

      const limit = tenancy.status === 'PENDING' ? tenancy.expiresAt!.getTime() : Infinity
      const expiresAt = new Date(Math.min(now.getTime() + SESSION_MAX_MS, limit))
      if (expiresAt.getTime() - now.getTime() < minWindow) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Sisa waktu pembayaran terlalu singkat. Hubungi pemilik kos.' })
      }
      const payment = await tx.payment.create({ data: { invoiceId, provider: provider.kind, status: 'CREATING', amount: invoice.amount, expiresAt } })
      return { created: { id: payment.id, amount: payment.amount, expiresAt } }
    })
  } catch (e) {
    // A concurrent writer won the partial unique index: hand back its attempt instead of a 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await prisma.payment.findFirst({ where: liveWhere, select: liveSelect })
      if (existing) return resultFor(existing)
    }
    throw e
  }

  if ('existing' in phase1) return resultFor(phase1.existing)
  const { id, amount, expiresAt } = phase1.created

  try {
    const session = await provider.createCheckout({ paymentId: id, amount, currency: 'IDR', expiresAt, ...returnUrls(id) })
    const done = await prisma.payment.updateMany({
      where: { id, status: 'CREATING' },
      data: {
        status: 'PENDING',
        providerSessionId: session.providerSessionId,
        providerPaymentRequestId: session.providerPaymentRequestId,
        providerBusinessId: session.providerBusinessId,
        checkoutUrl: session.checkoutUrl,
        expiresAt: session.expiresAt,
      },
    })
    if (done.count === 0) throw new TRPCError({ code: 'CONFLICT', message: 'Silakan coba lagi.' })
    if (provider.kind === 'XENDIT') {
      if (!session.checkoutUrl?.startsWith('https://')) {
        await prisma.payment.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'FAILED', failureCode: 'INVALID_CHECKOUT_URL' } })
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Gagal membuat sesi pembayaran. Coba lagi.' })
      }
      return { kind: 'REDIRECT', paymentId: id, checkoutUrl: session.checkoutUrl, expiresAt: session.expiresAt }
    }
    return { kind: 'DEMO', paymentId: id, expiresAt: session.expiresAt }
  } catch (e) {
    if (e instanceof TRPCError) throw e
    // Unknown outcome (timeout/5xx): the Session may exist; the webhook recovers it via reference_id = Payment.id.
    if (e instanceof XenditError && e.outcomeUnknown) return { kind: 'PROCESSING', paymentId: id }
    const failureCode = e instanceof XenditError ? e.code : 'PROVIDER_ERROR'
    await prisma.payment.updateMany({ where: { id, status: 'CREATING' }, data: { status: 'FAILED', failureCode } })
    throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Gagal membuat sesi pembayaran. Coba lagi.' })
  }
}
