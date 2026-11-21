import { isStudentVerified } from '@kobo/shared/domain'
import { TRPCError } from '@trpc/server'
import { authedProcedure } from '../trpc.ts'

/** Unimplemented stub body. */
export const todo = async (): Promise<never> => {
  throw new TRPCError({ code: 'METHOD_NOT_SUPPORTED', message: 'Belum tersedia.' })
}

/**
 * Every matching procedure: signed in and a currently verified student (read from the database, expiry-aware). Unlike
 * studentProcedure this does NOT depend on REQUIRE_STUDENT_VERIFICATION: matching is never open to unverified users.
 * Demo accounts are exempt so the demo works.
 */
export const matchingProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const u = await ctx.prisma.user.findUnique({ where: { id: ctx.user.id }, select: { isDemo: true, campusEmailVerifiedAt: true, campusVerifiedUntil: true } })
  if (!u) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Silakan masuk terlebih dahulu.' })
  if (!u.isDemo && !isStudentVerified(u, new Date())) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Fitur Teman Sekamar khusus mahasiswa terverifikasi. Verifikasi status mahasiswa Anda di halaman Profil.' })
  }
  return next()
})
