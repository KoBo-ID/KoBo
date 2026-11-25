import type { CampusVerifyMethod, StudentVerificationStatus } from '@kobo/shared/types'
import { isStudentVerified, STUDENT_VERIFICATION_MAX_DAYS } from '@kobo/shared/domain'
import type { PrismaClient } from '../db/client.ts'
import { campusForDomain, emailDomain } from '../campusEmail.ts'
import { ktmAutoReviewSeconds } from '../env.ts'
import type { Prisma } from '../generated/prisma/client.ts'

/** A student gets this many KTM rejections, then must use another way (campus email or account) or contact KoBo. */
export const KTM_MAX_ATTEMPTS = 3

/**
 * Rejections that count toward the limit: decided by a reviewer, not withdrawn by the student (no reviewer) and not
 * cleared by `reset` (reviewer prefixed "reset:"). Deliberately ignores deletedAt: the 30-day photo purge must not give
 * attempts back.
 */
export const countedRejectionWhere = (userId: string) => ({
  userId,
  kind: 'KTM' as const,
  status: 'REJECTED' as const,
  AND: [{ reviewer: { not: null } }, { NOT: { reviewer: { startsWith: 'reset:' } } }],
})

export interface ApplyVerificationInput {
  via: CampusVerifyMethod
  until: Date
  campusShortName?: string
  /** The Campus row the student verified with. Latest verification wins, even when the longer expiry is kept. */
  campusId?: string
}

/**
 * The ONE write that sets campusEmailVerifiedAt = now, campusVerifiedVia, campusVerifiedUntil and verifiedCampusId (and campus when empty).
 * Never shortens: a currently verified user whose stored expiry is later than the new one, verifying by a DIFFERENT
 * method, keeps via/until (but verifiedCampusId always follows the latest verification; an existing null "legacy never expires" counts as the latest). The new expiry is capped at now + 365 days.
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
  if (input.campusId) data.verifiedCampusId = input.campusId
  const keep =
    isStudentVerified(u, now) &&
    u.campusVerifiedVia !== input.via &&
    (u.campusVerifiedUntil === null || u.campusVerifiedUntil.getTime() > until.getTime())
  if (!keep) {
    // Legacy column name: intentionally written for every verification method (including KTM) because isStudentVerified checks it (SIM-030).
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
    select: { email: true, verifiedCampusId: true, campus: true, campusEmailVerifiedAt: true, campusVerifiedVia: true, campusVerifiedUntil: true },
  })
  const rejected = await prisma.studentDocument.count({ where: countedRejectionWhere(userId) })
  const slaText = ktmAutoReviewSeconds() ? 'Biasanya selesai dalam ±20 menit' : 'Biasanya selesai dalam 1×24 jam'
  const campusNameOf = async (id: string | null): Promise<string | null> =>
    id ? ((await prisma.campus.findUnique({ where: { id }, select: { name: true } }))?.name ?? null) : null
  const base = {
    via: u.campusVerifiedVia,
    until: u.campusVerifiedUntil?.toISOString() ?? null,
    campus: u.campus,
    reason: null,
    providers,
    attemptsLeft: Math.max(0, KTM_MAX_ATTEMPTS - rejected),
    submittedAt: null as string | null,
    slaText,
    accountCampusEmail: null as string | null,
    campusId: u.verifiedCampusId,
    campusName: await campusNameOf(u.verifiedCampusId),
    lastRejectedDraft: null as StudentVerificationStatus['lastRejectedDraft'],
  }
  if (isStudentVerified(u, now)) return { ...base, state: 'VERIFIED' }
  const domain = emailDomain(u.email)
  if (domain) {
    const campuses = await prisma.campus.findMany({ where: { studentEmailDomains: { has: domain } }, select: { studentEmailDomains: true }, take: 50 })
    if (campusForDomain(domain, campuses)) base.accountCampusEmail = u.email.toLowerCase()
  }
  const docs = await prisma.studentDocument.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { status: true, reason: true, createdAt: true, campusId: true, nameOnCard: true, nim: true, program: true },
  })
  const pending = docs.find((d) => d.status === 'PENDING')
  if (pending) return { ...base, state: 'PENDING', submittedAt: pending.createdAt.toISOString() }
  const last = docs[0]
  if (last && last.status === 'REJECTED' && (!u.campusEmailVerifiedAt || last.createdAt > u.campusEmailVerifiedAt)) {
    const lastRejectedDraft = { campusId: last.campusId, campusName: await campusNameOf(last.campusId), nameOnCard: last.nameOnCard, nim: last.nim, program: last.program }
    return { ...base, state: 'REJECTED', reason: last.reason, lastRejectedDraft }
  }
  if (u.campusEmailVerifiedAt) return { ...base, state: 'EXPIRED' }
  return { ...base, state: 'NONE', via: null, until: null }
}
