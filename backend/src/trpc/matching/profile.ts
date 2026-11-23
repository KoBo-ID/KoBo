// Matching sub-router: own profile, discover, detail (T1); composed in ../matching.ts.
import { anchorDistanceKm, ageOf, hardFilter, MIN_MATCH_AGE } from '@kobo/shared/domain'
import { discoverInput, matchingDetailInput, matchingEmailOptOutInput, matchingMarkFoundInput, matchingProfileUpsertInput, matchingSetActiveInput } from '@kobo/shared/schemas'
import type { DiscoverResult, MatchCandidate, MyMatchingProfile } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import { blockedUserIds, engagedUserIds, loadEligiblePair } from '../../matching/eligibility.ts'
import { campusNamesFor, defaultKosType, MAX_RADIUS_KM, scoreView, toCandidate, toMatchInput, toMyProfile, touchActive, visibleWhere, type Db } from '../../matching/profiles.ts'
import { router } from '../trpc.ts'
import { matchingProcedure } from './guard.ts'

export const PAGE_SIZE = 20
export const MAX_RESULTS = 100
const WIDEN_KM = 2
const CANDIDATE_SCAN_LIMIT = 2000
const NOT_VISIBLE = 'Profil tidak tersedia.'
const NO_PROFILE_MESSAGE = 'Buat profil teman sekamar dulu.'

/** PENDING requests in either direction -> CANCELLED. Used by deactivate, markFound and delete. */
async function cancelPendingRequests(db: Db, userId: string, now: Date): Promise<void> {
  await db.partnerRequest.updateMany({
    where: { status: 'PENDING', OR: [{ fromUserId: userId }, { toUserId: userId }] },
    data: { status: 'CANCELLED', decidedAt: now },
  })
}

const myRow = async (db: Db, userId: string) => {
  const row = await db.matchingProfile.findUnique({ where: { userId } })
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: NO_PROFILE_MESSAGE })
  return row
}

const profile = router({
  get: matchingProcedure.query(async ({ ctx }): Promise<MyMatchingProfile | null> => {
    await touchActive(ctx.prisma, ctx.user.id)
    const row = await ctx.prisma.matchingProfile.findUnique({ where: { userId: ctx.user.id } })
    return row ? toMyProfile(row) : null
  }),

  upsert: matchingProcedure.input(matchingProfileUpsertInput).mutation(async ({ ctx, input }): Promise<MyMatchingProfile> => {
    const now = new Date()
    if (ageOf(input.birthYear, now) < MIN_MATCH_AGE) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Teman Sekamar hanya untuk pengguna berusia ${MIN_MATCH_AGE} tahun ke atas.` })
    }
    const user = await ctx.prisma.user.findUnique({ where: { id: ctx.user.id }, select: { verifiedCampusId: true } })
    const { kosType, ...rest } = input
    const data = { ...rest, moveInDate: new Date(`${input.moveInDate}T00:00:00.000Z`), campusId: user?.verifiedCampusId ?? null, lastActiveAt: now }
    const existing = await ctx.prisma.matchingProfile.findUnique({ where: { userId: ctx.user.id } })
    const row = existing
      ? await ctx.prisma.matchingProfile.update({ where: { userId: ctx.user.id }, data: { ...data, kosType: kosType ?? existing.kosType } })
      : // The core fields are all required by the schema, so a new profile is active at once.
        await ctx.prisma.matchingProfile.create({ data: { ...data, userId: ctx.user.id, active: true, kosType: kosType ?? defaultKosType(input.gender) } })
    return toMyProfile(row, now)
  }),

  setActive: matchingProcedure.input(matchingSetActiveInput).mutation(async ({ ctx, input }): Promise<MyMatchingProfile> => {
    const now = new Date()
    const existing = await myRow(ctx.prisma, ctx.user.id)
    if (input.active && existing.hiddenByReportsAt !== null) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Profil Anda sedang disembunyikan karena laporan dan tidak dapat diaktifkan kembali.',
      })
    }
    const row = await ctx.prisma.$transaction(async (tx) => {
      if (!input.active) await cancelPendingRequests(tx, ctx.user.id, now)
      return tx.matchingProfile.update({
        where: { userId: ctx.user.id },
        data: input.active ? { active: true, pausedAt: null, lastActiveAt: now } : { active: false },
      })
    })
    return toMyProfile(row, now)
  }),

  /** Switches the matching emails (requests, accepts, digests) on or off. */
  setEmailOptOut: matchingProcedure.input(matchingEmailOptOutInput).mutation(async ({ ctx, input }): Promise<MyMatchingProfile> => {
    await myRow(ctx.prisma, ctx.user.id)
    const row = await ctx.prisma.matchingProfile.update({ where: { userId: ctx.user.id }, data: { emailOptOut: input.emailOptOut } })
    return toMyProfile(row)
  }),

  delete: matchingProcedure.mutation(async ({ ctx }): Promise<{ ok: true }> => {
    const now = new Date()
    const me = ctx.user.id
    await ctx.prisma.$transaction(async (tx) => {
      await cancelPendingRequests(tx, me, now)
      await tx.partnerConnection.updateMany({
        where: { endedAt: null, OR: [{ userAId: me }, { userBId: me }] },
        data: { endedAt: now, endedById: me, endReason: 'PROFILE_DELETED' },
      })
      await tx.matchingProfile.deleteMany({ where: { userId: me } })
    })
    return { ok: true }
  }),

  /** "Sudah dapat teman sekamar": pause the profile and cancel pending requests; connections stay. */
  markFound: matchingProcedure.input(matchingMarkFoundInput).mutation(async ({ ctx }): Promise<MyMatchingProfile> => {
    const now = new Date()
    await myRow(ctx.prisma, ctx.user.id)
    const row = await ctx.prisma.$transaction(async (tx) => {
      await cancelPendingRequests(tx, ctx.user.id, now)
      return tx.matchingProfile.update({ where: { userId: ctx.user.id }, data: { pausedAt: now } })
    })
    return toMyProfile(row, now)
  }),
})

const discover = matchingProcedure.input(discoverInput).query(async ({ ctx, input }): Promise<DiscoverResult> => {
  const now = new Date()
  const me = ctx.user.id
  const empty = (emptyReason: DiscoverResult['emptyReason'], extra: Partial<DiscoverResult> = {}): DiscoverResult => ({ items: [], nextCursor: null, emptyReason, ...extra })

  const mine = await ctx.prisma.matchingProfile.findUnique({ where: { userId: me } })
  if (!mine) return empty('NO_PROFILE')
  await touchActive(ctx.prisma, me, now)
  if (!mine.active || mine.pausedAt !== null || mine.hiddenByReportsAt !== null) return empty('INACTIVE')

  const viewer = await ctx.prisma.user.findUnique({ where: { id: me }, select: { isDemo: true } })
  const [blocked, engaged] = await Promise.all([blockedUserIds(ctx.prisma, me), engagedUserIds(ctx.prisma, me)])
  const excluded = [...new Set([me, ...blocked, ...engaged])]
  const rows = await ctx.prisma.matchingProfile.findMany({
    where: { ...visibleWhere(now, viewer?.isDemo ?? false), gender: mine.gender, userId: { notIn: excluded } },
    orderBy: [{ lastActiveAt: 'desc' }, { id: 'asc' }],
    take: CANDIDATE_SCAN_LIMIT,
  })

  const effectiveRadius = input.maxDistanceKm !== undefined ? Math.min(MAX_RADIUS_KM, Math.max(1, input.maxDistanceKm)) : mine.radiusKm
  const mineInput = { ...toMatchInput(mine), radiusKm: effectiveRadius }
  const moveInBefore = input.moveInBefore ? new Date(`${input.moveInBefore}T00:00:00.000Z`).getTime() : null
  const passesNonDistanceFilters = (o: (typeof rows)[number]) =>
    (input.budgetMin === undefined || o.budgetMax >= input.budgetMin) &&
    (input.budgetMax === undefined || o.budgetMin <= input.budgetMax) &&
    (moveInBefore === null || o.moveInDate.getTime() <= moveInBefore)

  const scored = []
  for (const o of rows) {
    const oi = toMatchInput(o)
    if (hardFilter(mineInput, oi) !== null) continue
    const km = anchorDistanceKm(mineInput, oi)
    if (km > effectiveRadius || !passesNonDistanceFilters(o)) continue
    scored.push({ o, km, score: scoreView(mine, o).score })
  }
  const time = (x: { o: { lastActiveAt: Date } }) => x.o.lastActiveAt.getTime()
  scored.sort((a, b) =>
    input.sort === 'jarak'
      ? a.km - b.km || b.score - a.score || time(b) - time(a) || a.o.id.localeCompare(b.o.id)
      : b.score - a.score || time(b) - time(a) || a.o.id.localeCompare(b.o.id),
  )
  const capped = scored.slice(0, MAX_RESULTS)

  const parsed = Number.parseInt(input.cursor ?? '0', 10)
  const offset = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  const page = capped.slice(offset, offset + PAGE_SIZE)

  if (capped.length === 0) {
    if (rows.length === 0) return empty('COLD_START')
    // Too narrow: count who a radius two km wider would add (counts only, no identities).
    const widened = Math.min(effectiveRadius + WIDEN_KM, MAX_RADIUS_KM)
    const wider = { ...mineInput, radiusKm: widened }
    let extra = 0
    if (effectiveRadius < MAX_RADIUS_KM) {
      for (const o of rows) {
        const oi = toMatchInput(o)
        if (hardFilter(wider, oi) !== null) continue
        if (passesNonDistanceFilters(o) && anchorDistanceKm(wider, oi) <= widened) extra += 1
      }
    }
    return empty('TOO_NARROW', { widenHint: { radiusKm: widened, extra } })
  }

  const names = await campusNamesFor(ctx.prisma, page.map((p) => p.o.campusId))
  const items = page.map((p) => toCandidate(mine, p.o, names, now))
  return { items, nextCursor: offset + PAGE_SIZE < capped.length ? String(offset + PAGE_SIZE) : null, emptyReason: null }
})

const detail = matchingProcedure.input(matchingDetailInput).query(async ({ ctx, input }): Promise<MatchCandidate> => {
  const now = new Date()
  const pair = await loadEligiblePair(ctx.prisma, ctx.user.id, input.profileId, now)
  if (!pair || (!pair.eligible && !pair.related)) throw new TRPCError({ code: 'NOT_FOUND', message: NOT_VISIBLE })
  await touchActive(ctx.prisma, ctx.user.id, now)
  const names = await campusNamesFor(ctx.prisma, [pair.other.campusId])
  return toCandidate(pair.mine, pair.other, names, now, pair.relation)
})

export const profileProcedures = { profile, discover, detail }
