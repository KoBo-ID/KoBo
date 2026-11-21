import { isAffiliatedCampus, isStudentVerified } from '@kobo/shared/domain'
import type { PrismaClient } from './db/client.ts'
import type { Prisma } from './generated/prisma/client.ts'

type Db = PrismaClient | Prisma.TransactionClient

/** Campus ids on the active "Kampus Mitra" list (an affiliated parent covers its branches, see isAffiliatedCampus). */
export async function loadAffiliatedSet(prisma: Db): Promise<Set<string>> {
  const rows = await prisma.campusAffiliation.findMany({ where: { active: true }, select: { campusId: true }, take: 500 })
  return new Set(rows.map((r) => r.campusId))
}

export interface DiscountUser {
  campusEmailVerifiedAt: Date | null
  campusVerifiedUntil: Date | null
  verifiedCampusId: string | null
}

/** "Diskon Kampus Mitra": the student is verified right now AND the campus they verified with is affiliated. */
export async function isDiscountEligible(prisma: Db, user: DiscountUser, now: Date): Promise<boolean> {
  if (!isStudentVerified(user, now) || !user.verifiedCampusId) return false
  const campus = await prisma.campus.findUnique({ where: { id: user.verifiedCampusId }, select: { id: true, parentId: true } })
  return isAffiliatedCampus(campus, await loadAffiliatedSet(prisma))
}
