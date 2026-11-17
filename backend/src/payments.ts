import { addMonths, todayWIB } from '@kobo/shared/domain'
import { enqueueEmail } from './outbox.ts'
import type { Prisma } from './generated/prisma/client.ts'

/*
 * Invoice fulfilment shared by every settlement path: provider events (payment/settlement.ts) and owner
 * "Tandai Lunas" (trpc/payment.ts recordManual) both end in settleInvoice(), inside their own transaction.
 */

type Tx = Prisma.TransactionClient

/**
 * Mark the invoice PAID and, when it is invoice #1 of a PENDING tenancy, activate that tenancy: room OCCUPIED,
 * invoices #2..N created, "pembayaran diterima" email queued. Must run inside the caller's transaction and
 * after the caller has locked the row that guards against a second settlement.
 */
export async function settleInvoice(tx: Tx, invoiceId: string, paymentId: string): Promise<void> {
  const invoice = await tx.invoice.update({
    where: { id: invoiceId },
    data: { status: 'PAID' },
    include: {
      tenancy: {
        include: {
          room: { include: { kos: { select: { name: true, owner: { select: { user: { select: { name: true, email: true } } } } } } } },
          user: { select: { name: true, email: true } },
          invoices: { select: { id: true } },
        },
      },
    },
  })
  // Any other live online attempt for this invoice is superseded; a later completed event for it takes the refund path.
  await tx.payment.updateMany({
    where: { invoiceId, id: { not: paymentId }, provider: { in: ['MOCK', 'XENDIT'] }, status: { in: ['CREATING', 'PENDING'] } },
    data: { status: 'FAILED', failureCode: 'SUPERSEDED' },
  })
  const { tenancy } = invoice
  // Invoice #1 is the only invoice a PENDING tenancy has. An ENDED tenancy (hold lost to someone else) is left alone.
  if (tenancy.status !== 'PENDING' || tenancy.invoices.length !== 1) return

  await tx.tenancy.update({ where: { id: tenancy.id }, data: { status: 'ACTIVE', expiresAt: null } })
  await tx.room.update({ where: { id: tenancy.roomId }, data: { occupancy: 'OCCUPIED' } })
  const first = todayWIB(tenancy.startDate)
  const later = Array.from({ length: tenancy.durationMonths - 1 }, (_, i) => {
    const due = new Date(`${addMonths(first, i + 1)}T00:00:00Z`)
    return {
      tenancyId: tenancy.id,
      periodStart: due,
      dueDate: due,
      amount: tenancy.room.priceMonthly,
      rentAmount: tenancy.room.priceMonthly,
      discountAmount: 0,
      applicationFeeAmount: 0,
      ownerReceivableAmount: tenancy.room.priceMonthly,
      gatewayFeeBearer: 'PLATFORM' as const,
    }
  })
  if (later.length) await tx.invoice.createMany({ data: later })

  const { receiptNo } = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { receiptNo: true } })
  const origin = (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
  await enqueueEmail(tx, {
    to: tenancy.user.email,
    template: 'payment-received',
    payload: { name: tenancy.user.name, url: `${origin}/kuitansi/${receiptNo}` },
  })
  // The owner hears about the same first settlement in the same transaction: both rows exist or neither does.
  const owner = tenancy.room.kos.owner.user
  await enqueueEmail(tx, {
    to: owner.email,
    template: 'payment-received-owner',
    payload: { name: owner.name, url: `${origin}/kuitansi/${receiptNo}`, tenantName: tenancy.user.name, kosName: tenancy.room.kos.name, roomNumber: tenancy.room.roomNumber, amount: invoice.amount },
  })
}
