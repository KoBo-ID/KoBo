import type { CampusVerifyMethod, StudentVerificationStatus } from '@kobo/shared/types'
import { isStudentVerified, STUDENT_VERIFICATION_MAX_DAYS } from '@kobo/shared/domain'
import type { PrismaClient } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'

export interface ApplyVerificationInput {
  via: CampusVerifyMethod
  until: Date
  campusShortName?: string
}

/**
 * The ONE write that sets campusEmailVerifiedAt = now, campusVerifiedVia and campusVerifiedUntil (and campus when empty).
 * Never shortens: a currently verified user whose stored expiry is later than the new one, verifying by a DIFFERENT
 * method, keeps via/until (an existing null "legacy never expires" counts as the latest). The new expiry is capped at now + 365 days.
 */
export async function applyVerification(tx: Prisma.TransactionClient, userId: string, input: ApplyVerificationInput, now: Date = new Date()): Promise<void> {
  const cap = new Date(now.getTime() + STUDENT_VERIFICATION_MAX_DAYS * 86_400_000)
  const until = input.until.getTime() > cap.getTime() ? cap : input.until
  const u = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { campus: true, campusEmailVerifiedAt: true, campusVerifiedVia: true, campusVerifiedUntil: true },
  })
  const data: Prisma.UserUpdateInput = {}
  if (!u.campus && input.campusShortName) data.campus = input.campusShortName
  const keep =
    isStudentVerified(u, now) &&
    u.campusVerifiedVia !== input.via &&
    (u.campusVerifiedUntil === null || u.campusVerifiedUntil.getTime() > until.getTime())
  if (!keep) {
    data.campusEmailVerifiedAt = now
    data.campusVerifiedVia = input.via
    data.campusVerifiedUntil = until
  }
  if (Object.keys(data).length > 0) await tx.user.update({ where: { id: userId }, data })
}

/** Shared by auth.me and studentVerification.status. */
export async function getStudentVerificationStatus(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  now: Date,
  providers: StudentVerificationStatus['providers'],
): Promise<StudentVerificationStatus> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { campus: true, campusEmailVerifiedAt: true, campusVerifiedVia: true, campusVerifiedUntil: true },
  })
  const base = { via: u.campusVerifiedVia, until: u.campusVerifiedUntil?.toISOString() ?? null, campus: u.campus, reason: null, providers }
  if (isStudentVerified(u, now)) return { ...base, state: 'VERIFIED' }
  const docs = await prisma.studentDocument.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 20, select: { status: true, reason: true, createdAt: true } })
  if (docs.some((d) => d.status === 'PENDING')) return { ...base, state: 'PENDING' }
  const last = docs[0]
  if (last && last.status === 'REJECTED' && (!u.campusEmailVerifiedAt || last.createdAt > u.campusEmailVerifiedAt)) return { ...base, state: 'REJECTED', reason: last.reason }
  if (u.campusEmailVerifiedAt) return { ...base, state: 'EXPIRED' }
  return { ...base, state: 'NONE', via: null, until: null }
}
