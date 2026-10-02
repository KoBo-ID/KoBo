import { formatReceiptNo } from '@kobo/shared/domain'
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
  method: 'MOCK' | 'MANUAL'
  payer: { name: string; campus: string | null }
  kos: { id: string; name: string; address: string }
  room: { roomNumber: string; floor: number; type: string }
  /** The month this payment covers (YYYY-MM-DD, WIB calendar day). */
  period: { periodStart: string; dueDate: string }
  owner: { name: string }
}

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export const kuitansiRouter = router({
  /** Allowed for the tenant who paid and for the owner of the kos. Unpaid or unknown numbers are NOT_FOUND. */
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
    if (!p || p.status !== 'PAID' || !p.paidAt) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kuitansi tidak ditemukan.' })
    const { tenancy } = p.invoice
    const { kos } = tenancy.room
    if (tenancy.user.id !== ctx.user.id && kos.owner.user.id !== ctx.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Anda tidak memiliki akses ke kuitansi ini.' })
    }
    return {
      receiptNumber: p.receiptNo,
      receiptNo: formatReceiptNo(p.receiptNo, p.paidAt),
      paidAt: p.paidAt.toISOString(),
      amount: p.amount,
      method: p.provider,
      payer: { name: tenancy.user.name, campus: tenancy.user.campus },
      kos: { id: kos.id, name: kos.name, address: kos.address },
      room: { roomNumber: tenancy.room.roomNumber, floor: tenancy.room.floor, type: tenancy.room.type },
      period: { periodStart: dateOnly(p.invoice.periodStart), dueDate: dateOnly(p.invoice.dueDate) },
      owner: { name: kos.owner.user.name },
    }
  }),
})
