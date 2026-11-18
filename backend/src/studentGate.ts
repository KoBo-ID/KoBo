import { TRPCError } from '@trpc/server'
import { isStudentVerified, STUDENT_VERIFICATION_REQUIRED } from '@kobo/shared/domain'
import type { PrismaClient } from './db/client.ts'

/** Whether new rental starts need a verified student. On in production unless REQUIRE_STUDENT_VERIFICATION=0; off elsewhere unless =1. */
export function studentVerificationRequired(): boolean {
  const flag = process.env.REQUIRE_STUDENT_VERIFICATION
  if (flag === '1') return true
  if (flag === '0') return false
  return process.env.NODE_ENV === 'production'
}

/** Fresh DB read (never the session snapshot). Demo accounts are exempt. */
export async function assertStudentVerified(prisma: Pick<PrismaClient, 'user'>, userId: string, now: Date): Promise<void> {
  if (!studentVerificationRequired()) return
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isDemo: true, campusEmailVerifiedAt: true, campusVerifiedUntil: true } })
  if (!u || u.isDemo) return
  if (!isStudentVerified(u, now)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Verifikasi status mahasiswa Anda dulu di halaman Profil sebelum menyewa.',
      cause: new Error(STUDENT_VERIFICATION_REQUIRED),
    })
  }
}
