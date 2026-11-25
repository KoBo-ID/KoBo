// Shared matching-profile helpers: row -> pure-score input, row -> API views, the discover visibility predicate.
import { ageBand, anchorDistanceKm, matchBand, matchScore, todayWIB } from '@kobo/shared/domain'
import type { MatchInput } from '@kobo/shared/domain'
import type { MatchCandidate, MatchScoreView, MyMatchingProfile } from '@kobo/shared/types'
import type { PrismaClient } from '../db/client.ts'
import { demoIsolationOn } from '../demoIsolation.ts'
import type { MatchingProfile, Prisma } from '../generated/prisma/client.ts'

export type Db = PrismaClient | Prisma.TransactionClient

export const IDLE_DAYS = 30
export const MAX_RADIUS_KM = 15
export const DAY_MS = 86_400_000
export const TOUCH_INTERVAL_MS = 3_600_000

/** 'YYYY-MM-DD' of a @db.Date value (stored as UTC midnight). */
export const dayString = (d: Date): string => d.toISOString().slice(0, 10)

/** The pure-score input of a stored profile. */
export function toMatchInput(p: MatchingProfile): MatchInput {
  return {
    gender: p.gender,
    budgetMin: p.budgetMin,
    budgetMax: p.budgetMax,
    anchorLat: p.anchorLat,
    anchorLng: p.anchorLng,
    radiusKm: p.radiusKm,
    moveInDate: dayString(p.moveInDate),
    durationMonths: p.durationMonths,
    kosType: p.kosType,
    roomShare: p.roomShare,
    sleep: p.sleep,
    tidiness: p.tidiness,
    smoking: p.smoking,
    guests: p.guests,
    noise: p.noise,
    social: p.social,
    study: p.study,
    ac: p.ac,
    expenses: p.expenses,
  }
}

/**
 * The visibility predicate: who may appear in someone else's discover (and be the target of a new request).
 * Active, not paused, not hidden by reports, seen within 30 days, move-in not past, and a currently verified student.
 * Demo profiles are visible only to demo viewers; when demo isolation is on, a demo viewer sees demo profiles and
 * accountless showcase seed profiles, otherwise any verified student.
 */
export function visibleWhere(now: Date, viewerIsDemo: boolean): Prisma.MatchingProfileWhereInput {
  const verified: Prisma.UserWhereInput = {
    AND: [{ campusEmailVerifiedAt: { not: null } }, { OR: [{ campusVerifiedUntil: null }, { campusVerifiedUntil: { gt: now } }] }],
  }
  const userFilter: Prisma.UserWhereInput = viewerIsDemo
    ? demoIsolationOn()
      ? { OR: [{ isDemo: true }, { isDemo: false, accounts: { none: {} }, ...verified }] }
      : { OR: [{ isDemo: true }, verified] }
    : { isDemo: false, ...verified }
  return {
    active: true,
    pausedAt: null,
    hiddenByReportsAt: null,
    lastActiveAt: { gte: new Date(now.getTime() - IDLE_DAYS * DAY_MS) },
    moveInDate: { gte: new Date(`${todayWIB(now)}T00:00:00.000Z`) },
    user: userFilter,
  }
}

/** Bumps lastActiveAt at most once per hour (stale-profile rule). */
export async function touchActive(db: Db, userId: string, now = new Date()): Promise<void> {
  await db.matchingProfile.updateMany({ where: { userId, lastActiveAt: { lt: new Date(now.getTime() - TOUCH_INTERVAL_MS) } }, data: { lastActiveAt: now } })
}

/** S1: a profile younger than 24 hours can receive requests but not send them. */
export const canSendRequests = (p: Pick<MatchingProfile, 'createdAt'>, now = new Date()): boolean => now.getTime() - p.createdAt.getTime() >= DAY_MS

export const defaultKosType = (gender: MatchingProfile['gender']): MatchingProfile['kosType'] => (gender === 'LAKI_LAKI' ? 'PUTRA' : 'PUTRI')

/** 0..100: share of the optional fields that differ from their defaults. */
export function completeness(p: MatchingProfile): number {
  const checks = [
    p.intro.length > 0,
    p.durationMonths !== 12,
    p.kosType !== defaultKosType(p.gender),
    p.roomShare !== 2,
    p.radiusKm !== 3,
    p.sleep !== 'BEBAS',
    p.tidiness !== 'BEBAS',
    p.guests !== 'BEBAS',
    p.noise !== 'BEBAS',
    p.social !== 'BEBAS',
    p.study !== 'BEBAS',
    p.ac !== 'BEBAS',
    p.expenses !== 'BEBAS',
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

export type MyProfileView = MyMatchingProfile & { canSendRequests: boolean }

export function toMyProfile(p: MatchingProfile, now = new Date()): MyProfileView {
  return {
    id: p.id,
    displayName: p.displayName,
    intro: p.intro,
    gender: p.gender,
    birthYear: p.birthYear,
    campusId: p.campusId,
    active: p.active,
    pausedAt: p.pausedAt ? p.pausedAt.toISOString() : null,
    hiddenByReportsAt: p.hiddenByReportsAt ? p.hiddenByReportsAt.toISOString() : null,
    emailOptOut: p.emailOptOut,
    budgetMin: p.budgetMin,
    budgetMax: p.budgetMax,
    anchorLat: p.anchorLat,
    anchorLng: p.anchorLng,
    anchorLabel: p.anchorLabel,
    radiusKm: p.radiusKm,
    moveInDate: dayString(p.moveInDate),
    durationMonths: p.durationMonths,
    kosType: p.kosType,
    roomShare: p.roomShare,
    completeness: completeness(p),
    sleep: p.sleep,
    tidiness: p.tidiness,
    smoking: p.smoking,
    guests: p.guests,
    noise: p.noise,
    social: p.social,
    study: p.study,
    ac: p.ac,
    expenses: p.expenses,
    canSendRequests: canSendRequests(p, now),
  }
}

export const roundHalfKm = (km: number): number => Math.round(km * 2) / 2

export function scoreView(mine: MatchingProfile, other: MatchingProfile): MatchScoreView {
  const r = matchScore(toMatchInput(mine), toMatchInput(other))
  return { score: r.score, band: matchBand(r.score), approximate: r.approximate, parts: r.parts }
}

export interface Relation {
  relation: MatchCandidate['relation']
  requestId: string | null
  connectionId: string | null
}
export const NO_RELATION: Relation = { relation: 'NONE', requestId: null, connectionId: null }

/** The other side as the viewer may see it: profileId only, an age band, a rounded distance, no contact or exact data. */
export function toCandidate(mine: MatchingProfile, other: MatchingProfile, campusNames: Map<string, string>, now: Date, rel: Relation = NO_RELATION): MatchCandidate {
  return {
    profileId: other.id,
    displayName: other.displayName,
    ageBand: ageBand(other.birthYear, now),
    gender: other.gender,
    campusLabel: other.campusId ? (campusNames.get(other.campusId) ?? null) : null,
    intro: other.intro,
    budgetMin: other.budgetMin,
    budgetMax: other.budgetMax,
    anchorLabel: other.anchorLabel,
    radiusKm: other.radiusKm,
    distanceKm: roundHalfKm(anchorDistanceKm(toMatchInput(mine), toMatchInput(other))),
    moveInDate: dayString(other.moveInDate),
    durationMonths: other.durationMonths,
    kosType: other.kosType,
    roomShare: other.roomShare,
    lastActiveAt: dayString(other.lastActiveAt),
    match: scoreView(mine, other),
    relation: rel.relation,
    requestId: rel.requestId,
    connectionId: rel.connectionId,
    sleep: other.sleep,
    tidiness: other.tidiness,
    smoking: other.smoking,
    guests: other.guests,
    noise: other.noise,
    social: other.social,
    study: other.study,
    ac: other.ac,
    expenses: other.expenses,
  }
}

export async function campusNamesFor(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))]
  if (uniq.length === 0) return new Map()
  const rows = await db.campus.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, parentId: true } })
  const parentIds = [...new Set(rows.map((r) => r.parentId).filter((x): x is string => !!x))]
  const parents = parentIds.length ? await db.campus.findMany({ where: { id: { in: parentIds } }, select: { id: true, name: true } }) : []
  const parentMap = new Map(parents.map((p) => [p.id, p.name]))
  return new Map(rows.map((r) => [r.id, (r.parentId && parentMap.get(r.parentId)) || r.name]))
}
