// Block, report and the reviewer functions behind `npm run matching:reports`.
import type { MatchBlockView } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '../db/client.ts'
import { DELETED_PARTNER_NAME, loadMyConnection } from './messages.ts'
import type { Db } from './profiles.ts'

export const HIDE_THRESHOLD = 3
export const SNAPSHOT_MESSAGES = 50
/** S1: shown under the PROFIL_PALSU reason. Copy only; the frontend renders it. */
export const PROFIL_PALSU_HINT = 'Gender tidak sesuai'

const pairWhere = (a: string, b: string) => [
  { userAId: a, userBId: b },
  { userAId: b, userBId: a },
]

/** Cancels all PENDING requests involving a user when auto-hidden or actioned. */
async function cancelPendingForUser(tx: Db, userId: string, now: Date): Promise<void> {
  await tx.partnerRequest.updateMany({
    where: { status: 'PENDING', OR: [{ fromUserId: userId }, { toUserId: userId }] },
    data: { status: 'CANCELLED', decidedAt: now },
  })
}

/** Creates the block, ends any live connection with BLOCKED and cancels PENDING requests in both directions. Idempotent. */
export async function blockInTx(tx: Db, blockerId: string, blockedId: string, now = new Date()): Promise<void> {
  await tx.userBlock.upsert({ where: { blockerId_blockedId: { blockerId, blockedId } }, create: { blockerId, blockedId }, update: {} })
  await tx.partnerConnection.updateMany({ where: { endedAt: null, OR: pairWhere(blockerId, blockedId) }, data: { endedAt: now, endedById: blockerId, endReason: 'BLOCKED' } })
  await tx.partnerRequest.updateMany({
    where: { status: 'PENDING', OR: [{ fromUserId: blockerId, toUserId: blockedId }, { fromUserId: blockedId, toUserId: blockerId }] },
    data: { status: 'CANCELLED', decidedAt: now },
  })
}

async function profileOrThrow(db: Db, me: string, profileId: string) {
  const p = await db.matchingProfile.findUnique({ where: { id: profileId }, select: { id: true, userId: true } })
  if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Profil tidak ditemukan.' })
  if (p.userId === me) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Kamu tidak bisa melakukan ini pada dirimu sendiri.' })
  return p
}

export async function blockProfile(prisma: PrismaClient, me: string, profileId: string, now = new Date()): Promise<{ ok: true }> {
  const p = await profileOrThrow(prisma, me, profileId)
  await prisma.$transaction((tx) => blockInTx(tx, me, p.userId, now))
  return { ok: true }
}

export async function unblock(db: Db, me: string, blockId: string): Promise<{ ok: true }> {
  const r = await db.userBlock.deleteMany({ where: { id: blockId, blockerId: me } })
  if (r.count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Blokir tidak ditemukan.' })
  return { ok: true }
}

export async function listBlocks(db: Db, me: string): Promise<MatchBlockView[]> {
  const rows = await db.userBlock.findMany({
    where: { blockerId: me },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { blocked: { select: { matchingProfile: { select: { id: true, displayName: true } } } } },
  })
  return rows.map((r) => ({
    id: r.id,
    profileId: r.blocked.matchingProfile?.id ?? null,
    displayName: r.blocked.matchingProfile?.displayName ?? DELETED_PARTNER_NAME,
    createdAt: r.createdAt.toISOString(),
  }))
}

export interface ReportArgs {
  profileId: string
  reason: 'PELECEHAN' | 'SPAM_PENIPUAN' | 'PROFIL_PALSU' | 'KONTEN_TIDAK_PANTAS' | 'LAINNYA'
  detail?: string
  connectionId?: string
  messageId?: string
}

/** Distinct reporters with an OPEN report that counts toward the auto-hide (S2). */
async function hideCount(db: Db, reportedId: string): Promise<number> {
  const rows = await db.userReport.findMany({ where: { reportedId, status: 'OPEN', countsForHide: true }, select: { reporterId: true }, distinct: ['reporterId'] })
  return rows.length
}

export async function reportProfile(prisma: PrismaClient, me: string, input: ReportArgs, now = new Date()): Promise<{ ok: true }> {
  const target = await profileOrThrow(prisma, me, input.profileId)
  const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Percakapan tidak ditemukan.' })

  // The context ids must belong to a connection the reporter is part of, with the reported person.
  let connectionId = input.connectionId ?? null
  if (input.messageId) {
    const m = await prisma.partnerMessage.findUnique({ where: { id: input.messageId }, select: { connectionId: true } })
    if (!m || (connectionId && m.connectionId !== connectionId)) throw notFound()
    connectionId = m.connectionId
  }
  if (connectionId) {
    const c = await loadMyConnection(prisma, me, connectionId)
    if (!c || (c.userAId !== target.userId && c.userBId !== target.userId)) throw notFound()
  }

  const [related, dup] = await Promise.all([
    Promise.all([
      prisma.partnerRequest.count({ where: { OR: [{ fromUserId: me, toUserId: target.userId }, { fromUserId: target.userId, toUserId: me }] } }),
      prisma.partnerConnection.count({ where: { OR: pairWhere(me, target.userId) } }),
    ]).then(([a, b]) => a + b > 0),
    prisma.userReport.count({ where: { reporterId: me, reportedId: target.userId, status: 'OPEN' } }),
  ])
  if (dup > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Kamu sudah melaporkan pengguna ini. Laporanmu sedang ditinjau.' })

  // S4: keep the last 50 messages so a later purge does not destroy the evidence.
  let snapshot: { id: string; from: 'pelapor' | 'terlapor'; body: string; hadContact: boolean; createdAt: string }[] | null = null
  if (!connectionId) {
    const c = await prisma.partnerConnection.findFirst({ where: { OR: pairWhere(me, target.userId) }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    connectionId = c?.id ?? null
  }
  if (connectionId) {
    const msgs = await prisma.partnerMessage.findMany({ where: { connectionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: SNAPSHOT_MESSAGES })
    snapshot = msgs.reverse().map((m) => ({ id: m.id, from: m.senderId === me ? 'pelapor' : 'terlapor', body: m.body, hadContact: m.hadContact, createdAt: m.createdAt.toISOString() }))
  }

  await prisma.$transaction(async (tx) => {
    await tx.userReport.create({
      data: {
        reporterId: me,
        reportedId: target.userId,
        reason: input.reason,
        detail: input.detail ?? '',
        connectionId,
        messageId: input.messageId ?? null,
        snapshot: snapshot ?? undefined,
        countsForHide: related,
        createdAt: now,
      },
    })
    // S2: a PELECEHAN report from someone who dealt with the target also blocks them for the reporter.
    if (related && input.reason === 'PELECEHAN') await blockInTx(tx, me, target.userId, now)
    if ((await hideCount(tx, target.userId)) >= HIDE_THRESHOLD) {
      await tx.matchingProfile.updateMany({ where: { id: target.id, hiddenByReportsAt: null }, data: { hiddenByReportsAt: now, active: false } })
      await cancelPendingForUser(tx, target.userId, now)
    }
  })
  return { ok: true }
}

// ---- Reviewer functions (CLI) ----

export class ReportReviewError extends Error {}

export interface OpenReportRow {
  id: string
  createdAt: Date
  reason: string
  reporter: string
  reported: string
  openAgainstReported: number
  countsForHide: boolean
}

const nameOf = (u: { name: string; matchingProfile: { displayName: string } | null }) => u.matchingProfile?.displayName ?? u.name

export async function listOpenReports(db: Db): Promise<OpenReportRow[]> {
  const rows = await db.userReport.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
    include: { reporter: { select: { name: true, matchingProfile: { select: { displayName: true } } } }, reported: { select: { name: true, matchingProfile: { select: { displayName: true } } } } },
  })
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.reportedId, (counts.get(r.reportedId) ?? 0) + 1)
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    reason: r.reason,
    reporter: nameOf(r.reporter),
    reported: nameOf(r.reported),
    openAgainstReported: counts.get(r.reportedId) ?? 0,
    countsForHide: r.countsForHide,
  }))
}

export async function showReport(db: Db, id: string) {
  const r = await db.userReport.findUnique({
    where: { id },
    include: {
      reporter: { select: { id: true, name: true, email: true, matchingProfile: { select: { displayName: true } } } },
      reported: { select: { id: true, name: true, email: true, matchingProfile: { select: { id: true, displayName: true, gender: true, birthYear: true, active: true, hiddenByReportsAt: true } } } },
    },
  })
  if (!r) throw new ReportReviewError('Laporan tidak ditemukan.')
  return r
}

async function closeAndLoad(tx: Db, id: string) {
  const r = await tx.userReport.findUnique({ where: { id } })
  if (!r) throw new ReportReviewError('Laporan tidak ditemukan.')
  if (r.status !== 'OPEN') throw new ReportReviewError(`Laporan ini sudah ditutup (${r.status}).`)
  return r
}

const reviewerLabel = (reviewer: string, note?: string) => (note ? `${reviewer}: ${note}` : reviewer).slice(0, 500)

/** Deactivates the reported profile (stays hidden) and closes every OPEN report against it as ACTIONED. */
export async function actionReport(prisma: PrismaClient, id: string, opts: { reviewer: string; note?: string }, now = new Date()): Promise<{ closed: number }> {
  return prisma.$transaction(async (tx) => {
    const r = await closeAndLoad(tx, id)
    const res = await tx.userReport.updateMany({
      where: { reportedId: r.reportedId, status: 'OPEN' },
      data: { status: 'ACTIONED', reviewer: reviewerLabel(opts.reviewer, opts.note), decidedAt: now },
    })
    await tx.matchingProfile.updateMany({ where: { userId: r.reportedId }, data: { active: false, hiddenByReportsAt: now } })
    await cancelPendingForUser(tx, r.reportedId, now)
    await tx.partnerConnection.updateMany({
      where: { endedAt: null, OR: [{ userAId: r.reportedId }, { userBId: r.reportedId }] },
      data: { endedAt: now, endedById: null, endReason: 'BLOCKED' },
    })
    return { closed: res.count }
  })
}

/** Closes one report. When fewer than 3 counting OPEN reports remain the profile is un-hidden (not reactivated). */
export async function dismissReport(prisma: PrismaClient, id: string, opts: { reviewer: string; note?: string }, now = new Date()): Promise<{ cleared: boolean }> {
  return prisma.$transaction(async (tx) => {
    const r = await closeAndLoad(tx, id)
    await tx.userReport.update({ where: { id }, data: { status: 'DISMISSED', reviewer: reviewerLabel(opts.reviewer, opts.note), decidedAt: now } })
    if ((await hideCount(tx, r.reportedId)) < HIDE_THRESHOLD) {
      const u = await tx.matchingProfile.updateMany({ where: { userId: r.reportedId, hiddenByReportsAt: { not: null } }, data: { hiddenByReportsAt: null } })
      return { cleared: u.count > 0 }
    }
    return { cleared: false }
  })
}
