import { TRPCError } from '@trpc/server'
import { resetDemo } from '../demoReset.ts'
import { authedProcedure, router } from './trpc.ts'

export const demoRouter = router({
  /** "Reset data demo": only the shared demo accounts may press it, and it only ever touches demo-owned rows. */
  reset: authedProcedure.mutation(async ({ ctx }): Promise<{ ok: true }> => {
    const user = await ctx.prisma.user.findUnique({ where: { id: ctx.user.id }, select: { isDemo: true } })
    if (!user?.isDemo) throw new TRPCError({ code: 'FORBIDDEN', message: 'Fitur ini hanya untuk akun demo.' })
    await resetDemo(ctx.prisma, new Date())
    return { ok: true }
  }),
})
