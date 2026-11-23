import { addDays, addMonths, formatReceiptNo } from '@kobo/shared/domain'
import { kuitansiGetInput } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import { authedProcedure, router } from './trpc.ts'

export interface KuitansiView {
  /** Raw Payment.receiptNo (the number in the URL). */
  receiptNumber: number
  /** KB/YYYY/MM/NNNN */
  receiptNo: string
  /** ISO timestamp. */
  paidAt: string
  amount: number
  /** PAID (also while a refund is in progress or failed) or REFUNDED ("Dibatalkan" on the page). Unpaid is NOT_FOUND. */
  status: 'PAID' | 'REFUNDED'
  /** What the receipt breaks the total into; total = rent + applicationFee - discount. */
  breakdown: { rent: number; applicationFee: number; discount: number; total: number }
  /** Gateway reference for online payments (null for manual ones, whose reference is in `manual`). */
  reference: string | null
  method: 'MOCK' | 'MANUAL' | 'XENDIT'
  /** Owner-recorded cash/transfer details. The private note is never part of the receipt. */
  manual: { method: 'CASH' | 'BANK_TRANSFER'; reference: string | null } | null
  payer: { name: string; campus: string | null }
  kos: { id: string; name: string; address: string; city: string }
  room: { roomNumber: string; floor: number; type: string }
  /** The month this payment covers (YYYY-MM-DD, WIB calendar days): periodStart through periodEnd inclusive. */
  period: { periodStart: string; periodEnd: string; dueDate: string }
  owner: { name: string }
  /** Whether the signed-in caller is viewing as the tenant who paid or as the owner of the kos. */
  viewerRole: 'TENANT' | 'OWNER'
}

const PAID_STATES = ['PAID', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED']

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export const kuitansiRouter = router({
  /** Allowed for the tenant who paid and for the owner of the kos. Unpaid, unknown and foreign numbers are all NOT_FOUND. */
  get: authedProcedure.input(kuitansiGetInput).query(async ({ ctx, input }): Promise<KuitansiView> => {
    const p = await ctx.prisma.payment.findUnique({
      where: { receiptNo: input.receiptNo },
      include: {
        invoice: {
          include: {
            tenancy: {
              include: {
                user: { select: { id: true, name: true, campus: true } },
                room: { include: { kos: { include: { owner: { include: { user: { select: { id: true, name: true } } } } } } } },
              },
            },
          },
        },
      },
    })
    if (!p || !PAID_STATES.includes(p.status) || !p.paidAt) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kuitansi tidak ditemukan.' })
    const { tenancy } = p.invoice
    const { kos } = tenancy.room
    // Receipt numbers are sequential, so a foreign receipt must look exactly like a missing one (no existence oracle).
    if (tenancy.user.id !== ctx.user.id && kos.owner.user.id !== ctx.user.id) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Kuitansi tidak ditemukan.' })
    }
    const periodStart = dateOnly(p.invoice.periodStart)
    return {
      receiptNumber: p.receiptNo,
      receiptNo: formatReceiptNo(p.receiptNo, p.paidAt),
      paidAt: p.paidAt.toISOString(),
      amount: p.amount,
      status: p.status === 'REFUNDED' ? 'REFUNDED' : 'PAID',
      breakdown: { rent: p.invoice.rentAmount, applicationFee: p.invoice.applicationFeeAmount, discount: p.invoice.discountAmount, total: p.amount },
      reference: p.provider === 'MANUAL' ? null : p.externalId,
      method: p.provider,
      manual: p.provider === 'MANUAL' && p.manualMethod ? { method: p.manualMethod, reference: p.manualReference } : null,
      payer: { name: tenancy.user.name, campus: tenancy.user.campus },
      kos: { id: kos.id, name: kos.name, address: kos.address, city: kos.city },
      room: { roomNumber: tenancy.room.roomNumber, floor: tenancy.room.floor, type: tenancy.room.type },
      period: { periodStart, periodEnd: addDays(addMonths(periodStart, 1), -1), dueDate: dateOnly(p.invoice.dueDate) },
      owner: { name: kos.owner.user.name },
      viewerRole: tenancy.user.id === ctx.user.id ? 'TENANT' : 'OWNER',
    }
  }),
})
