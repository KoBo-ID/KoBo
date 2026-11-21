// Pair eligibility for matching: blocks, existing requests and connections, and the shared "may this pair meet" check.
import type { MatchingProfile } from '../generated/prisma/client.ts'
import { NO_RELATION, visibleWhere, type Db, type Relation } from './profiles.ts'

/** True when either user blocked the other. */
export async function isBlockedEither(db: Db, a: string, b: string): Promise<boolean> {
  const n = await db.userBlock.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })
  return n > 0
}

/** Every user id the viewer blocked or was blocked by. */
export async function blockedUserIds(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } })
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)))
}

/** Every user the viewer has a PENDING request or a live connection with (either direction). */
export async function engagedUserIds(db: Db, userId: string): Promise<Set<string>> {
  const [reqs, conns] = await Promise.all([
    db.partnerRequest.findMany({ where: { status: 'PENDING', OR: [{ fromUserId: userId }, { toUserId: userId }] }, select: { fromUserId: true, toUserId: true } }),
    db.partnerConnection.findMany({ where: { endedAt: null, OR: [{ userAId: userId }, { userBId: userId }] }, select: { userAId: true, userBId: true } }),
  ])
  const out = new Set<string>()
  for (const r of reqs) out.add(r.fromUserId === userId ? r.toUserId : r.fromUserId)
  for (const c of conns) out.add(c.userAId === userId ? c.userBId : c.userAId)
  return out
}

export interface EligiblePair {
  mine: MatchingProfile
  other: MatchingProfile
  /** The pair may meet: both visible, same gender, not blocked, and no PENDING request or live connection (strict: a new request is allowed). */
  eligible: boolean
  /** Any request (any status) or connection exists between the two users, so detail may be shown even when not eligible. */
  related: boolean
  /** PENDING request or live connection state of the pair. */
  relation: Relation
}

/**
 * Loads both profiles for a viewer and a target profileId. Returns null when the target is missing, is the viewer, the viewer has no
 * profile, or either user blocked the other (callers map null to NOT_FOUND). Otherwise the flags say what is allowed.
 */
export async function loadEligiblePair(db: Db, viewerUserId: string, profileId: string, now = new Date()): Promise<EligiblePair | null> {
  const mine = await db.matchingProfile.findUnique({ where: { userId: viewerUserId } })
  const other = await db.matchingProfile.findUnique({ where: { id: profileId } })
  if (!mine || !other || other.userId === viewerUserId) return null
  if (await isBlockedEither(db, viewerUserId, other.userId)) return null

  const [reqs, conns, viewer] = await Promise.all([
    db.partnerRequest.findMany({
      where: { OR: [{ fromUserId: viewerUserId, toUserId: other.userId }, { fromUserId: other.userId, toUserId: viewerUserId }] },
      select: { id: true, fromUserId: true, status: true },
    }),
    db.partnerConnection.findMany({
      where: { OR: [{ userAId: viewerUserId, userBId: other.userId }, { userAId: other.userId, userBId: viewerUserId }] },
      select: { id: true, endedAt: true },
    }),
    db.user.findUnique({ where: { id: viewerUserId }, select: { isDemo: true } }),
  ])
  const live = conns.find((c) => c.endedAt === null)
  const pending = reqs.find((r) => r.status === 'PENDING')
  let relation: Relation = NO_RELATION
  if (live) relation = { relation: 'CONNECTED', requestId: null, connectionId: live.id }
  else if (pending) relation = { relation: pending.fromUserId === viewerUserId ? 'REQUEST_SENT' : 'REQUEST_RECEIVED', requestId: pending.id, connectionId: null }

  const visible = await db.matchingProfile.count({ where: { id: other.id, ...visibleWhere(now, viewer?.isDemo ?? false) } })
  const eligible = visible > 0 && mine.active && mine.pausedAt === null && mine.hiddenByReportsAt === null && mine.gender === other.gender && relation.relation === 'NONE'
  return { mine, other, eligible, related: reqs.length > 0 || conns.length > 0, relation }
}
