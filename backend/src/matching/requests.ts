import { ageBand, containsContactInfo, hardFilter, isStudentVerified, matchBand, matchScore } from '@kobo/shared/domain'
import type { MatchInput } from '@kobo/shared/domain'
import type { MatchScoreView, PartnerConnectionView, PartnerRef, PartnerRequestList, PartnerRequestView } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '../db/client.ts'
import type { Prisma } from '../generated/prisma/client.ts'

/*
 * Partner requests and connections (T1). Every function takes `now` so tests pin the clock; the tRPC layer passes new Date().
 * Private helpers here (eligibility, block check) are intentionally small copies: the orchestrator dedupes them against matching/eligibility.ts.
 */

type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx

const DAY = 86_400_000
export const REQUEST_TTL_DAYS = 14
export const COOLDOWN_DAYS = 30
export const MAX_PENDING_OUT = 10
export const MAX_SENT_PER_DAY = 10
export const MAX_LIVE_CONNECTIONS = 3
export const MIN_PROFILE_AGE_HOURS = 24
const SEEN_DAYS = 30
export const LIST_PAGE = 20

export const CAP_MESSAGE = 'Akhiri satu koneksi dulu sebelum menerima permintaan baru.'
export const YOUNG_PROFILE_MESSAGE = 'Profil baru bisa mengirim permintaan 24 jam setelah dibuat.'

const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])
const originUrl = () => (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')

/** Persists lazy expiry: PENDING requests past expiresAt become EXPIRED. Scoped to `userIds` (either side) when given. Returns the count. */
export async function expireRequests(db: Db, now: Date, userIds?: string[]): Promise<number> {
  const where: Prisma.PartnerRequestWhereInput = { status: 'PENDING', expiresAt: { lte: now } }
  if (userIds) where.OR = [{ fromUserId: { in: userIds } }, { toUserId: { in: userIds } }]
  const res = await db.partnerRequest.updateMany({ where, data: { status: 'EXPIRED', decidedAt: now } })
  return res.count
}

const liveWhere = (userId: string): Prisma.PartnerConnectionWhereInput => ({ endedAt: null, OR: [{ userAId: userId }, { userBId: userId }] })
const liveCount = (db: Db, userId: string) => db.partnerConnection.count({ where: liveWhere(userId) })

async function isBlockedEither(db: Db, a: string, b: string): Promise<boolean> {
  const n = await db.userBlock.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })
  return n > 0
}

type ProfileRow = Prisma.MatchingProfileGetPayload<object>
type ProfileWithUser = Prisma.MatchingProfileGetPayload<{ include: { user: { select: { email: true; isDemo: true; campusEmailVerifiedAt: true; campusVerifiedUntil: true; name: true } } } }>

const userSelect = { email: true, isDemo: true, campusEmailVerifiedAt: true, campusVerifiedUntil: true, name: true } as const

/** The other side may be written to / accepted: verified, active, visible, same gender, recently seen, not blocked. */
async function isEligible(db: Db, mine: ProfileRow, other: ProfileWithUser, now: Date): Promise<boolean> {
  if (other.userId === mine.userId) return false
  if (!other.active || other.pausedAt || other.hiddenByReportsAt) return false
  if (other.gender !== mine.gender) return false
  if (other.lastActiveAt.getTime() < now.getTime() - SEEN_DAYS * DAY) return false
  if (!other.user.isDemo && !isStudentVerified(other.user, now)) return false
  return !(await isBlockedEither(db, mine.userId, other.userId))
}

function toInput(p: ProfileRow): MatchInput {
  return {
    sleep: p.sleep, tidiness: p.tidiness, smoking: p.smoking, guests: p.guests, noise: p.noise, social: p.social, study: p.study, ac: p.ac, expenses: p.expenses,
    gender: p.gender, budgetMin: p.budgetMin, budgetMax: p.budgetMax, anchorLat: p.anchorLat, anchorLng: p.anchorLng, radiusKm: p.radiusKm,
    moveInDate: p.moveInDate.toISOString().slice(0, 10), durationMonths: p.durationMonths, kosType: p.kosType, roomShare: p.roomShare,
  }
}

function scoreView(a: ProfileRow | undefined, b: ProfileRow | undefined): MatchScoreView | null {
  if (!a || !b) return null
  const x = toInput(a)
  const y = toInput(b)
  if (hardFilter(x, y)) return null
  const r = matchScore(x, y)
  return { score: r.score, band: matchBand(r.score), approximate: r.approximate, parts: r.parts }
}

function partnerRef(p: ProfileRow | undefined, now: Date): PartnerRef {
  if (!p) return { profileId: null, displayName: 'Pengguna KoBo', deleted: true, ageBand: null }
  return { profileId: p.id, displayName: p.displayName, deleted: false, ageBand: ageBand(p.birthYear, now) }
}

async function profilesByUser(db: Db, userIds: string[]): Promise<Map<string, ProfileRow>> {
  const rows = await db.matchingProfile.findMany({ where: { userId: { in: userIds } } })
  return new Map(rows.map((r) => [r.userId, r]))
}

type RequestRow = Prisma.PartnerRequestGetPayload<object>

async function requestViews(db: Db, meId: string, rows: RequestRow[], now: Date): Promise<PartnerRequestView[]> {
  if (rows.length === 0) return []
  const others = rows.map((r) => (r.fromUserId === meId ? r.toUserId : r.fromUserId))
  const profiles = await profilesByUser(db, [meId, ...others])
  const mine = profiles.get(meId)
  const atCap = rows.some((r) => r.toUserId === meId && r.status === 'PENDING') ? (await liveCount(db, meId)) >= MAX_LIVE_CONNECTIONS : false
  return rows.map((r) => {
    const sent = r.fromUserId === meId
    const other = profiles.get(sent ? r.toUserId : r.fromUserId)
    return {
      id: r.id,
      direction: sent ? 'sent' : 'received',
      partner: partnerRef(other, now),
      message: r.message,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      match: scoreView(mine, other),
      blockedByCap: !sent && r.status === 'PENDING' && atCap,
    }
  })
}

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Permintaan tidak ditemukan.' })

/** Explains why a conditional transition updated nothing. Runs outside any transaction that must roll back. */
async function explainNoTransition(db: Db, requestId: string, role: 'from' | 'to', meId: string, now: Date): Promise<never> {
  const row = await db.partnerRequest.findUnique({ where: { id: requestId } })
  if (!row || (role === 'from' ? row.fromUserId : row.toUserId) !== meId) throw notFound()
  if (row.status === 'PENDING') {
    // Past its expiry: persist it (lazy expiry) and say so.
    await expireRequests(db, now, [meId])
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Permintaan ini sudah kedaluwarsa.' })
  }
  if (row.status === 'EXPIRED') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Permintaan ini sudah kedaluwarsa.' })
  throw new TRPCError({ code: 'CONFLICT', message: 'Permintaan ini sudah diproses.' })
}

const isUniqueViolation = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'

async function lockUsers(tx: Tx, ids: string[]): Promise<void> {
  for (const id of [...ids].sort()) await tx.$queryRaw`SELECT 1 FROM "User" WHERE id = ${id} FOR UPDATE`
}

export async function sendRequest(prisma: PrismaClient, meId: string, input: { profileId: string; message?: string }, now: Date): Promise<PartnerRequestView> {
  const message = (input.message ?? '').trim()
  if (message && containsContactInfo(message)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pesan tidak boleh berisi nomor telepon, email, atau tautan. Bagikan kontak setelah terhubung.' })
  }
  try {
    return await prisma.$transaction(async (tx) => {
      await lockUsers(tx, [meId])
      const mine = await tx.matchingProfile.findUnique({ where: { userId: meId } })
      if (!mine || !mine.active || mine.pausedAt) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Aktifkan profil Teman Sekamar Anda untuk mengirim permintaan.' })
      }
      if (mine.createdAt.getTime() > now.getTime() - MIN_PROFILE_AGE_HOURS * 3600_000) {
        throw new TRPCError({ code: 'FORBIDDEN', message: YOUNG_PROFILE_MESSAGE })
      }
      const target = await tx.matchingProfile.findUnique({ where: { id: input.profileId }, include: { user: { select: userSelect } } })
      if (target && target.userId === meId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Anda tidak bisa mengirim permintaan ke diri sendiri.' })
      if (!target || !(await isEligible(tx, mine, target, now))) throw new TRPCError({ code: 'NOT_FOUND', message: 'Profil tidak ditemukan.' })

      await expireRequests(tx, now, [meId, target.userId])
      const [a, b] = pairOf(meId, target.userId)
      if (await tx.partnerConnection.findFirst({ where: { userAId: a, userBId: b, endedAt: null }, select: { id: true } })) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Anda sudah terhubung dengan pengguna ini.' })
      }
      const pending = await tx.partnerRequest.findFirst({
        where: { status: 'PENDING', OR: [{ fromUserId: meId, toUserId: target.userId }, { fromUserId: target.userId, toUserId: meId }] },
        select: { fromUserId: true },
      })
      if (pending) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: pending.fromUserId === meId ? 'Permintaan Anda masih menunggu jawaban.' : 'Pengguna ini sudah mengirim permintaan kepada Anda. Terima permintaannya di kotak masuk.',
        })
      }
      const declined = await tx.partnerRequest.findFirst({
        where: { fromUserId: meId, toUserId: target.userId, status: 'DECLINED', decidedAt: { gt: new Date(now.getTime() - COOLDOWN_DAYS * DAY) } },
        select: { id: true },
      })
      if (declined) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Permintaan sebelumnya tidak dilanjutkan. Coba lagi beberapa minggu lagi.' })

      if ((await liveCount(tx, meId)) >= MAX_LIVE_CONNECTIONS) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Anda sudah punya 3 koneksi aktif. Akhiri satu koneksi dulu untuk mengirim permintaan baru.' })
      }
      if ((await tx.partnerRequest.count({ where: { fromUserId: meId, status: 'PENDING' } })) >= MAX_PENDING_OUT) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Anda punya 10 permintaan yang belum dijawab. Tunggu jawaban atau batalkan salah satu.' })
      }
      if ((await tx.partnerRequest.count({ where: { fromUserId: meId, createdAt: { gt: new Date(now.getTime() - DAY) } } })) >= MAX_SENT_PER_DAY) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Batas 10 permintaan per hari tercapai. Coba lagi besok.' })
      }

      const row = await tx.partnerRequest.create({
        data: { fromUserId: meId, toUserId: target.userId, message, createdAt: now, expiresAt: new Date(now.getTime() + REQUEST_TTL_DAYS * DAY) },
      })
      if (!target.emailOptOut) {
        // No message text and no sender contact: the mail only says a request is waiting.
        await tx.emailOutbox.create({
          data: { to: target.user.email, template: 'matching-request', payload: { name: target.user.name, url: `${originUrl()}/teman-sekamar/permintaan` } },
        })
      }
      return { id: row.id, direction: 'sent' as const, partner: partnerRef(target, now), message: row.message, status: row.status, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), match: scoreView(mine, target), blockedByCap: false }
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: 'Permintaan untuk pengguna ini sudah ada.' })
    throw e
  }
}

async function simpleTransition(prisma: PrismaClient, meId: string, requestId: string, role: 'from' | 'to', status: 'CANCELLED' | 'DECLINED', now: Date): Promise<{ ok: true }> {
  const res = await prisma.partnerRequest.updateMany({
    where: { id: requestId, [role === 'from' ? 'fromUserId' : 'toUserId']: meId, status: 'PENDING', expiresAt: { gt: now } },
    data: { status, decidedAt: now },
  })
  if (res.count === 0) await explainNoTransition(prisma, requestId, role, meId, now)
  return { ok: true }
}

export const cancelRequest = (prisma: PrismaClient, meId: string, requestId: string, now: Date) => simpleTransition(prisma, meId, requestId, 'from', 'CANCELLED', now)
export const declineRequest = (prisma: PrismaClient, meId: string, requestId: string, now: Date) => simpleTransition(prisma, meId, requestId, 'to', 'DECLINED', now)

export async function acceptRequest(prisma: PrismaClient, meId: string, requestId: string, now: Date): Promise<PartnerConnectionView> {
  let connectionId: string | null
  try {
    connectionId = await prisma.$transaction(async (tx) => {
      const peek = await tx.partnerRequest.findUnique({ where: { id: requestId }, select: { fromUserId: true, toUserId: true } })
      if (!peek || peek.toUserId !== meId) throw notFound()
      await lockUsers(tx, [peek.fromUserId, peek.toUserId])
      const res = await tx.partnerRequest.updateMany({ where: { id: requestId, toUserId: meId, status: 'PENDING', expiresAt: { gt: now } }, data: { status: 'ACCEPTED', decidedAt: now } })
      if (res.count === 0) return null
      // Anything thrown from here rolls the update back: the request stays PENDING.
      const mine = await tx.matchingProfile.findUnique({ where: { userId: meId } })
      const sender = await tx.matchingProfile.findUnique({ where: { userId: peek.fromUserId }, include: { user: { select: userSelect } } })
      if (!mine || !mine.active || mine.pausedAt || !sender || !(await isEligible(tx, mine, sender, now))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Permintaan ini tidak lagi tersedia.' })
      }
      if ((await liveCount(tx, meId)) >= MAX_LIVE_CONNECTIONS) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: CAP_MESSAGE })
      if ((await liveCount(tx, peek.fromUserId)) >= MAX_LIVE_CONNECTIONS) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Pengirim sudah mencapai batas koneksi aktif. Coba lagi nanti.' })
      }
      const [a, b] = pairOf(meId, peek.fromUserId)
      const conn = await tx.partnerConnection.create({ data: { userAId: a, userBId: b, requestId, createdAt: now } })
      if (!sender.emailOptOut) {
        await tx.emailOutbox.create({
          data: { to: sender.user.email, template: 'matching-accept', payload: { name: sender.user.name, url: `${originUrl()}/teman-sekamar/pesan` } },
        })
      }
      return conn.id
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: 'Anda sudah terhubung dengan pengguna ini.' })
    throw e
  }
  if (!connectionId) return explainNoTransition(prisma, requestId, 'to', meId, now)
  const views = await connectionViews(prisma, meId, [await prisma.partnerConnection.findUniqueOrThrow({ where: { id: connectionId } })], now)
  return views[0]!
}

export async function listRequests(prisma: PrismaClient, meId: string, input: { box: 'sent' | 'received'; cursor?: string }, now: Date): Promise<PartnerRequestList> {
  await expireRequests(prisma, now, [meId])
  const rows = await prisma.partnerRequest.findMany({
    where: input.box === 'sent' ? { fromUserId: meId } : { toUserId: meId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: LIST_PAGE,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  })
  const [pending, sentToday] = await Promise.all([
    prisma.partnerRequest.count({ where: { fromUserId: meId, status: 'PENDING' } }),
    prisma.partnerRequest.count({ where: { fromUserId: meId, createdAt: { gt: new Date(now.getTime() - DAY) } } }),
  ])
  return {
    items: await requestViews(prisma, meId, rows, now),
    nextCursor: rows.length === LIST_PAGE ? rows[rows.length - 1].id : null,
    pendingSlotsLeft: Math.max(0, MAX_PENDING_OUT - pending),
    sentTodayLeft: Math.max(0, MAX_SENT_PER_DAY - sentToday),
  }
}

type ConnectionRow = Prisma.PartnerConnectionGetPayload<object>

async function connectionViews(db: Db, meId: string, rows: ConnectionRow[], now: Date): Promise<PartnerConnectionView[]> {
  if (rows.length === 0) return []
  const others = rows.map((c) => (c.userAId === meId ? c.userBId : c.userAId))
  const profiles = await profilesByUser(db, [meId, ...others])
  const mine = profiles.get(meId)
  return Promise.all(
    rows.map(async (c, i) => {
      const other = profiles.get(others[i]!)
      const [read, last] = await Promise.all([
        db.connectionReadState.findUnique({ where: { connectionId_userId: { connectionId: c.id, userId: meId } } }),
        db.partnerMessage.findFirst({ where: { connectionId: c.id }, orderBy: { createdAt: 'desc' } }),
      ])
      const unread = await db.partnerMessage.count({ where: { connectionId: c.id, senderId: { not: meId }, ...(read ? { createdAt: { gt: read.lastReadAt } } : {}) } })
      return {
        id: c.id,
        partner: partnerRef(other, now),
        createdAt: c.createdAt.toISOString(),
        endedAt: c.endedAt ? c.endedAt.toISOString() : null,
        endReason: c.endReason,
        unread,
        lastMessage: last ? { body: last.body, mine: last.senderId === meId, createdAt: last.createdAt.toISOString() } : null,
        match: scoreView(mine, other),
      }
    }),
  )
}

export async function listConnections(prisma: PrismaClient, meId: string, now: Date): Promise<PartnerConnectionView[]> {
  const rows = await prisma.partnerConnection.findMany({ where: { OR: [{ userAId: meId }, { userBId: meId }] }, orderBy: { createdAt: 'desc' }, take: 50 })
  // Live first, then the most recently ended.
  rows.sort((x, y) => Number(x.endedAt !== null) - Number(y.endedAt !== null) || y.createdAt.getTime() - x.createdAt.getTime())
  return connectionViews(prisma, meId, rows, now)
}

export async function endConnection(prisma: PrismaClient, meId: string, connectionId: string, now: Date): Promise<{ ok: true }> {
  const res = await prisma.partnerConnection.updateMany({
    where: { id: connectionId, endedAt: null, OR: [{ userAId: meId }, { userBId: meId }] },
    data: { endedAt: now, endedById: meId, endReason: 'ENDED_BY_USER' },
  })
  if (res.count === 0) {
    const row = await prisma.partnerConnection.findFirst({ where: { id: connectionId, OR: [{ userAId: meId }, { userBId: meId }] }, select: { id: true } })
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Koneksi tidak ditemukan.' })
    throw new TRPCError({ code: 'CONFLICT', message: 'Koneksi ini sudah berakhir.' })
  }
  return { ok: true }
}
