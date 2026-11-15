import { formatReceiptNo } from '@kobo/shared/domain'
import { invoiceIdInput, paymentIdInput, recordManualInput } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import { expireStaleAttempts, hasLiveAttempt, startPaymentAttempt, type StartPaymentResult } from '../payment/attempts.ts'
import type { PrismaClient } from '../db/client.ts'
import { mockCompletedEvent, MOCK_BUSINESS_ID } from '../payment/mock.ts'
import { reconcilePayment } from '../payment/reconcile.ts'
import { applyPaymentEventTx } from '../payment/settlement.ts'
import { toPaymentSummary } from '../payment/summary.ts'
import type { PaymentSummary } from '../payment/summary.ts'
import { settleInvoice } from '../payments.ts'
import { authedProcedure, ownerProcedure, router } from './trpc.ts'

export interface PaymentStatusResult extends PaymentSummary {
  invoiceId: string
  amount: number
  tenancyStatus: 'PENDING' | 'ACTIVE' | 'ENDED'
  /** The refund for a late payment, if one was queued. */
  refund: { status: 'PENDING' | 'SUBMITTED' | 'SUCCEEDED' | 'FAILED' } | null
}

async function statusFor(prisma: PrismaClient, userId: string, paymentId: string, now = new Date()): Promise<PaymentStatusResult> {
  const p = await prisma.payment.findFirst({
    where: { id: paymentId, invoice: { tenancy: { userId } } },
    include: { invoice: { include: { tenancy: { select: { status: true } } } }, refund: { select: { status: true } } },
  })
  if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pembayaran tidak ditemukan.' })
  return {
    ...toPaymentSummary(p, now),
    invoiceId: p.invoiceId,
    amount: p.amount,
    tenancyStatus: p.invoice.tenancy.status,
    refund: p.refund ? { status: p.refund.status } : null,
  }
}

export const paymentRouter = router({
  /** Opens (or reuses) the one live online payment attempt for the caller's own unpaid invoice. */
  start: authedProcedure.input(invoiceIdInput).mutation(
    ({ ctx, input }): Promise<StartPaymentResult> => startPaymentAttempt(ctx.prisma, ctx.paymentProvider, ctx.user.id, input.invoiceId),
  ),

  /** Polled by checkout. Only the payer can read it; anyone else sees NOT_FOUND. */
  status: authedProcedure.input(paymentIdInput).query(({ ctx, input }): Promise<PaymentStatusResult> => statusFor(ctx.prisma, ctx.user.id, input.paymentId)),

  /** "Periksa Status": asks the provider server-to-server (throttled) and applies the answer like a webhook would. */
  reconcile: authedProcedure.input(paymentIdInput).mutation(async ({ ctx, input }): Promise<PaymentStatusResult> => {
    await reconcilePayment(ctx.prisma, ctx.paymentService, ctx.user.id, input.paymentId)
    return statusFor(ctx.prisma, ctx.user.id, input.paymentId)
  }),

  /**
   * "Selesaikan Pembayaran": demo users only. Feeds a normalized completed event for the caller's own PENDING MOCK
   * attempt to the same settlement a real gateway webhook uses, so nobody can pay for someone else's booking.
   */
  simulate: authedProcedure.input(paymentIdInput).mutation(async ({ ctx, input }): Promise<{ status: 'PAID' }> => {
    if (!ctx.user.isDemo) throw new TRPCError({ code: 'FORBIDDEN', message: 'Pembayaran ini tidak dapat diselesaikan dari akun Anda.' })
    const payment = await ctx.prisma.payment.findFirst({
      where: { id: input.paymentId, provider: 'MOCK', status: 'PENDING', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], invoice: { tenancy: { userId: ctx.user.id } } },
      select: { id: true, amount: true, providerSessionId: true, providerBusinessId: true },
    })
    if (!payment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pembayaran tidak ditemukan atau sudah diproses.' })
    const now = new Date()
    const res = await applyPaymentEventTx(ctx.prisma, { provider: 'MOCK', expectedBusinessId: MOCK_BUSINESS_ID, now }, mockCompletedEvent(payment, now))
    if (res.outcome !== 'SETTLED') throw new TRPCError({ code: 'CONFLICT', message: 'Pembayaran tidak dapat diselesaikan. Mulai pembayaran baru.' })
    return { status: 'PAID' }
  }),

  /**
   * Owner "Tandai Lunas": a MANUAL payment on one invoice of the owner's own kos. ownerProcedure proves the caller owns
   * `kosId`; the invoice must then belong to that kos. Invoice #1 of a PENDING tenancy activates it like the webhook.
   */
  recordManual: ownerProcedure.input(recordManualInput).mutation(async ({ ctx, input }): Promise<{ paymentId: string; receiptNumber: number; receiptNo: string }> => {
    return ctx.prisma.$transaction(async (tx) => {
      // Lock order matches settlement and payment.start: Invoice, then Tenancy. The row lock also serialises double clicks.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`
      const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { tenancy: { include: { room: { select: { kosId: true } } } } } })
      if (!invoice || invoice.tenancy.room.kosId !== input.kosId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tagihan tidak ditemukan.' })
      if (invoice.status === 'PAID') throw new TRPCError({ code: 'CONFLICT', message: 'Tagihan ini sudah lunas.' })
      if (input.confirmedAmount !== invoice.amount) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Jumlah tidak sesuai dengan tagihan.' })
      const now = new Date()

      // Never supersede an online attempt the tenant may still complete: that would take their money twice.
      await expireStaleAttempts(tx, invoice.id, now)
      if (await hasLiveAttempt(tx, invoice.id, now)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Penyewa sedang membayar secara online. Tunggu hingga sesi pembayaran berakhir.' })
      }

      // A manual payment must not revive a hold that already lapsed or a tenancy that was ended.
      await tx.$queryRaw`SELECT id FROM "Tenancy" WHERE id = ${invoice.tenancyId} FOR UPDATE`
      const tenancy = await tx.tenancy.findUniqueOrThrow({ where: { id: invoice.tenancyId }, include: { invoices: { select: { id: true }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: 1 } } })
      if (tenancy.status === 'ENDED') throw new TRPCError({ code: 'CONFLICT', message: 'Sewa ini sudah berakhir.' })
      if (tenancy.status === 'PENDING' && !(tenancy.invoices[0]?.id === invoice.id && tenancy.expiresAt && tenancy.expiresAt > now)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Masa tahan kamar sudah berakhir.' })
      }

      const payment = await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          provider: 'MANUAL',
          amount: invoice.amount,
          status: 'PAID',
          paidAt: now,
          manualMethod: input.method,
          manualReference: input.reference ?? null,
          manualNote: input.note || null,
          recordedById: ctx.user.id,
        },
      })
      await settleInvoice(tx, invoice.id, payment.id)
      return { paymentId: payment.id, receiptNumber: payment.receiptNo, receiptNo: formatReceiptNo(payment.receiptNo, now) }
    })
  }),
})
