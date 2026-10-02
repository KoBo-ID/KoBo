import { formatReceiptNo } from '@kobo/shared/domain'
import { paymentIdInput, recordManualInput } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import { paymentWebhookSecret } from '../env.ts'
import { handlePaymentWebhook, hmacHex, settleInvoice } from '../payments.ts'
import { authedProcedure, ownerProcedure, router } from './trpc.ts'

export interface PaymentStatusResult {
  status: 'PENDING' | 'PAID' | 'FAILED'
  tenancyStatus: 'PENDING' | 'ACTIVE' | 'ENDED'
  /** Raw Payment.receiptNo for /kuitansi/:receiptNo; null until paid. */
  receiptNumber: number | null
  receiptNo: string | null
}

export const paymentRouter = router({
  /** Polled by checkout. Only the payer can read it; anyone else sees NOT_FOUND. */
  status: authedProcedure.input(paymentIdInput).query(async ({ ctx, input }): Promise<PaymentStatusResult> => {
    const p = await ctx.prisma.payment.findFirst({
      where: { id: input.paymentId, invoice: { tenancy: { userId: ctx.user.id } } },
      include: { invoice: { include: { tenancy: { select: { status: true } } } } },
    })
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pembayaran tidak ditemukan.' })
    const paid = p.status === 'PAID' && p.paidAt
    return {
      status: p.status,
      tenancyStatus: p.invoice.tenancy.status,
      receiptNumber: paid ? p.receiptNo : null,
      receiptNo: paid ? formatReceiptNo(p.receiptNo, p.paidAt!) : null,
    }
  }),

  /**
   * "Simulasikan Pembayaran" (spec section 6). Signs a PAID event for the caller's own PENDING MOCK payment and feeds it
   * to the same handler as the webhook route. The signer is never reachable from the client, so nobody can pay for
   * someone else's booking. Available in production to signed-in users: without it a reviewer cannot finish a booking.
   */
  simulate: authedProcedure.input(paymentIdInput).mutation(async ({ ctx, input }): Promise<{ status: 'PAID' }> => {
    const payment = await ctx.prisma.payment.findFirst({
      where: { id: input.paymentId, provider: 'MOCK', status: 'PENDING', externalId: { not: null }, invoice: { tenancy: { userId: ctx.user.id } } },
      select: { externalId: true },
    })
    if (!payment?.externalId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pembayaran tidak ditemukan atau sudah diproses.' })
    const secret = paymentWebhookSecret()
    const rawBody = JSON.stringify({ externalId: payment.externalId, status: 'PAID' })
    const res = await handlePaymentWebhook(ctx.prisma, { rawBody, signature: hmacHex(rawBody, secret), secret })
    if (res.status !== 200) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Simulasi pembayaran gagal.' })
    return { status: 'PAID' }
  }),

  /**
   * Owner "Tandai Lunas": a MANUAL payment on one invoice of the owner's own kos. ownerProcedure proves the caller owns
   * `kosId`; the invoice must then belong to that kos. Invoice #1 of a PENDING tenancy activates it like the webhook.
   */
  recordManual: ownerProcedure.input(recordManualInput).mutation(async ({ ctx, input }): Promise<{ paymentId: string; receiptNumber: number; receiptNo: string }> => {
    return ctx.prisma.$transaction(async (tx) => {
      // The row lock serialises concurrent clicks: the second sees PAID and gets CONFLICT.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${input.invoiceId} FOR UPDATE`
      const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { tenancy: { include: { room: { select: { kosId: true } } } } } })
      if (!invoice || invoice.tenancy.room.kosId !== input.kosId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Tagihan tidak ditemukan.' })
      if (invoice.status === 'PAID') throw new TRPCError({ code: 'CONFLICT', message: 'Tagihan ini sudah lunas.' })
      const now = new Date()
      // Any unpaid online attempt for this invoice is superseded (a late webhook must not credit it twice).
      await tx.payment.updateMany({ where: { invoiceId: invoice.id, status: 'PENDING' }, data: { status: 'FAILED' } })
      const payment = await tx.payment.create({ data: { invoiceId: invoice.id, provider: 'MANUAL', amount: invoice.amount, status: 'PAID', paidAt: now } })
      await settleInvoice(tx, invoice.id, payment.id)
      return { paymentId: payment.id, receiptNumber: payment.receiptNo, receiptNo: formatReceiptNo(payment.receiptNo, now) }
    })
  }),
})
