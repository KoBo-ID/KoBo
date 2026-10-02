import { profileUpdateInput } from '@kobo/shared/schemas'
import { authedProcedure, publicProcedure, router } from './trpc.ts'

export interface MeResult {
  user: { id: string; name: string; email: string; image: string | null; phone: string | null; campus: string | null; campusEmail: string | null; isDemo: boolean }
  /** "Is owner" is exactly `ownerProfile != null` (spec section 3). */
  isOwner: boolean
  ownerProfileId: string | null
  campusVerified: boolean
}

export const authRouter = router({
  /** The signed-in user, or null. The frontend derives persona and route guards from this. */
  me: publicProcedure.query(async ({ ctx }): Promise<MeResult | null> => {
    const session = await ctx.getSession()
    if (!session) return null
    const u = await ctx.prisma.user.findUnique({ where: { id: session.user.id }, include: { ownerProfile: { select: { id: true } } } })
    if (!u) return null
    return {
      user: { id: u.id, name: u.name, email: u.email, image: u.image, phone: u.phone, campus: u.campus, campusEmail: u.campusEmail, isDemo: u.isDemo },
      isOwner: u.ownerProfile !== null,
      ownerProfileId: u.ownerProfile?.id ?? null,
      campusVerified: u.campusEmailVerifiedAt !== null,
    }
  }),

  /** Name, WhatsApp number and campus of the caller. Email and password never change here (demo guard). */
  updateProfile: authedProcedure.input(profileUpdateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    await ctx.prisma.user.update({ where: { id: ctx.user.id }, data: { name: input.name, phone: input.phone, campus: input.campus || null } })
    return { id: ctx.user.id }
  }),
})
