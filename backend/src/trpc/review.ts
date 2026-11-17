import { reviewCreateInput, reviewReplyInput, reviewUpdateInput } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import { authedProcedure, ownerProcedure, router } from './trpc.ts'

/** The author may edit a review for this long after writing it. */
export const REVIEW_EDIT_DAYS = 14
const DAY_MS = 24 * 3600_000

export const reviewEditable = (createdAt: Date, now: Date) => now.getTime() - createdAt.getTime() <= REVIEW_EDIT_DAYS * DAY_MS

/** A tenancy may be reviewed once it was activated: ACTIVE, or ENDED after a paid invoice (never a lapsed hold). */
export const reviewEligible = (t: { status: 'PENDING' | 'ACTIVE' | 'ENDED'; invoices: { status: 'UNPAID' | 'PAID' }[] }) =>
  t.status === 'ACTIVE' || (t.status === 'ENDED' && t.invoices.some((i) => i.status === 'PAID'))

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: unknown } | null
  return !!err && (err.code === 'P2002' || `${err.message ?? ''} ${JSON.stringify(err.meta ?? {})}`.includes('23505'))
}

const subColumns = (s: { cleanliness?: number; wifi?: number; owner?: number; quietness?: number }) => ({
  cleanliness: s.cleanliness ?? null,
  wifi: s.wifi ?? null,
  ownerRating: s.owner ?? null,
  quietness: s.quietness ?? null,
})

export const reviewRouter = router({
  /** One review per tenancy, written by its tenant once the tenancy was activated. */
  create: authedProcedure.input(reviewCreateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    const tenancy = await ctx.prisma.tenancy.findUnique({
      where: { id: input.tenancyId },
      select: { userId: true, status: true, invoices: { select: { status: true } }, review: { select: { id: true } } },
    })
    if (!tenancy || tenancy.userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Anda hanya dapat mengulas kos yang pernah Anda sewa.' })
    if (!reviewEligible(tenancy)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Ulasan baru dapat ditulis setelah pembayaran sewa berhasil.' })
    const conflict = new TRPCError({ code: 'CONFLICT', message: 'Anda sudah mengulas sewa ini' })
    if (tenancy.review) throw conflict
    const author = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { campusEmailVerifiedAt: true } })
    try {
      return await ctx.prisma.review.create({
        data: {
          tenancyId: input.tenancyId,
          rating: input.rating,
          ...subColumns(input.subRatings),
          comment: input.comment,
          verifiedStudent: author.campusEmailVerifiedAt !== null,
        },
        select: { id: true },
      })
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict
      throw e
    }
  }),

  /** The author edits rating, sub-ratings and comment for REVIEW_EDIT_DAYS; the verified snapshot never changes. */
  update: authedProcedure.input(reviewUpdateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    const review = await ctx.prisma.review.findUnique({ where: { id: input.reviewId }, select: { createdAt: true, tenancy: { select: { userId: true } } } })
    if (!review || review.tenancy.userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Anda hanya dapat mengubah ulasan Anda sendiri.' })
    if (!reviewEditable(review.createdAt, new Date())) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `Ulasan hanya dapat diubah dalam ${REVIEW_EDIT_DAYS} hari setelah ditulis.` })
    }
    await ctx.prisma.review.update({
      where: { id: input.reviewId },
      data: { rating: input.rating, ...subColumns(input.subRatings), comment: input.comment },
    })
    return { id: input.reviewId }
  }),

  /** The owner of the review's kos answers it. A second reply replaces the first (typo fixes), keeping one reply per review. */
  reply: ownerProcedure.input(reviewReplyInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    const { count } = await ctx.prisma.review.updateMany({
      where: { id: input.reviewId, tenancy: { room: { kosId: input.kosId } } },
      data: { ownerReply: input.text, ownerReplyAt: new Date() },
    })
    if (count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ulasan tidak ditemukan.' })
    return { id: input.reviewId }
  }),
})
