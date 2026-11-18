import { STUDENT_VERIFICATION_MAX_DAYS } from '@kobo/shared/domain'
import type { PrismaClient } from '../db/client.ts'
import type { Storage } from '../storage.ts'
import { applyVerification } from './verifier.ts'

const DAY = 86_400_000
/** KTM photos are kept this long after a decision, then purged by the retention job. */
export const KTM_RETENTION_DAYS = 30
const SHOW_URL_SECONDS = 120

export class ReviewError extends Error {}

export interface PendingRow {
  id: string
  createdAt: Date
  email: string
  name: string
  campus: string | null
  nim: string | null
}

export async function listPending(prisma: PrismaClient): Promise<PendingRow[]> {
  const rows = await prisma.studentDocument.findMany({
    where: { status: 'PENDING', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, createdAt: true, campusId: true, nim: true, user: { select: { email: true, name: true } } },
  })
  const campuses = await prisma.campus.findMany({ where: { id: { in: rows.flatMap((r) => (r.campusId ? [r.campusId] : [])) } }, select: { id: true, shortName: true } })
  const short = new Map(campuses.map((c) => [c.id, c.shortName]))
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, email: r.user.email, name: r.user.name, campus: r.campusId ? (short.get(r.campusId) ?? null) : null, nim: r.nim }))
}

export interface ShownDocument {
  id: string
  status: string
  name: string
  email: string
  campus: string | null
  nim: string | null
  nameOnCard: string | null
  createdAt: Date
  url: string
}

/** Operator-only: a 120 s read URL for the card photo. */
export async function showDocument(prisma: PrismaClient, storage: Storage, id: string): Promise<ShownDocument> {
  const d = await prisma.studentDocument.findUnique({ where: { id }, include: { user: { select: { name: true, email: true } } } })
  if (!d || d.deletedAt) throw new ReviewError('Dokumen tidak ditemukan atau sudah dihapus.')
  const campus = d.campusId ? await prisma.campus.findUnique({ where: { id: d.campusId }, select: { name: true } }) : null
  const url = await storage.presignPrivateGet(d.key, SHOW_URL_SECONDS)
  return { id: d.id, status: d.status, name: d.user.name, email: d.user.email, campus: campus?.name ?? null, nim: d.nim, nameOnCard: d.nameOnCard, createdAt: d.createdAt, url }
}

/** `YYYY-MM-DD` to the last millisecond of that day in WIB (UTC+7). */
function endOfDayWib(day: string): Date {
  return new Date(`${day}T23:59:59.999+07:00`)
}

export async function approveDocument(
  prisma: PrismaClient,
  id: string,
  opts: { reviewer: string; validUntil: string },
  now: Date = new Date(),
): Promise<{ userId: string; until: Date }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.validUntil)) throw new ReviewError('Tanggal harus berformat YYYY-MM-DD.')
  const until = endOfDayWib(opts.validUntil)
  if (Number.isNaN(until.getTime())) throw new ReviewError('Tanggal tidak valid.')
  if (until.getTime() <= now.getTime()) throw new ReviewError('Tanggal berlaku harus di masa depan.')
  if (until.getTime() > now.getTime() + STUDENT_VERIFICATION_MAX_DAYS * DAY) throw new ReviewError(`Tanggal berlaku maksimal ${STUDENT_VERIFICATION_MAX_DAYS} hari dari sekarang.`)
  return prisma.$transaction(async (tx) => {
    const d = await tx.studentDocument.findUnique({ where: { id } })
    if (!d) throw new ReviewError('Dokumen tidak ditemukan.')
    // Conditional update: a concurrent decision or a withdraw leaves count 0.
    const res = await tx.studentDocument.updateMany({
      where: { id, status: 'PENDING', deletedAt: null },
      data: { status: 'APPROVED', decidedAt: now, reviewer: opts.reviewer, validUntil: new Date(`${opts.validUntil}T00:00:00.000Z`), deleteAfter: new Date(now.getTime() + KTM_RETENTION_DAYS * DAY) },
    })
    if (res.count !== 1) throw new ReviewError('Hanya dokumen berstatus PENDING yang bisa diputuskan.')
    const campus = d.campusId ? await tx.campus.findUnique({ where: { id: d.campusId }, select: { shortName: true } }) : null
    await applyVerification(tx, d.userId, { via: 'KTM', until, campusShortName: campus?.shortName }, now)
    return { userId: d.userId, until }
  })
}

export async function rejectDocument(prisma: PrismaClient, id: string, opts: { reviewer: string; reason: string }, now: Date = new Date()): Promise<{ userId: string }> {
  const reason = opts.reason.trim()
  if (!reason) throw new ReviewError('Alasan penolakan wajib diisi.')
  const d = await prisma.studentDocument.findUnique({ where: { id }, select: { userId: true } })
  if (!d) throw new ReviewError('Dokumen tidak ditemukan.')
  const res = await prisma.studentDocument.updateMany({
    where: { id, status: 'PENDING', deletedAt: null },
    data: { status: 'REJECTED', decidedAt: now, reviewer: opts.reviewer, reason, deleteAfter: new Date(now.getTime() + KTM_RETENTION_DAYS * DAY) },
  })
  if (res.count !== 1) throw new ReviewError('Hanya dokumen berstatus PENDING yang bisa diputuskan.')
  return { userId: d.userId }
}
