import { isCalendarDay, STUDENT_VERIFICATION_MAX_DAYS } from '@kobo/shared/domain'
import type { PrismaClient } from '../db/client.ts'
import { enqueueEmail } from '../outbox.ts'
import type { Storage } from '../storage.ts'
import { applyVerification, countedRejectionWhere, KTM_MAX_ATTEMPTS } from './verifier.ts'

export { KTM_MAX_ATTEMPTS }

const DAY = 86_400_000
/** KTM photos are kept this long after a decision, then purged by the retention job. */
export const KTM_RETENTION_DAYS = 30
const SHOW_URL_SECONDS = 120

export class ReviewError extends Error {}

/** Reject codes and the Indonesian reason (with what to do next) the student sees. */
export const KTM_REJECT_REASONS = {
  FOTO_BURAM: 'Foto kurang jelas. Ambil ulang tanpa blur atau pantulan cahaya.',
  NAMA_TIDAK_SESUAI: 'Nama atau NIM di KTM tidak sama dengan yang Anda isi. Periksa isian lalu unggah ulang.',
  KTM_KEDALUWARSA: 'KTM sudah kedaluwarsa. Unggah KTM yang masih berlaku atau kartu rencana studi semester ini.',
  KAMPUS_TIDAK_COCOK: 'Kampus di KTM tidak sama dengan kampus yang Anda pilih. Pilih kampus yang benar lalu unggah ulang.',
  BUKAN_KTM: 'Foto yang diunggah bukan KTM. Unggah foto kartu tanda mahasiswa Anda.',
} as const
export type KtmRejectCode = keyof typeof KTM_REJECT_REASONS
export const isKtmRejectCode = (v: string): v is KtmRejectCode => Object.hasOwn(KTM_REJECT_REASONS, v)

const appUrl = (path: string) => `${(process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')}${path}`

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
    take: 200,
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
  if (!isCalendarDay(opts.validUntil)) throw new ReviewError('Tanggal tidak valid.')
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
    const campus = d.campusId ? await tx.campus.findUnique({ where: { id: d.campusId }, select: { id: true, shortName: true } }) : null
    await applyVerification(tx, d.userId, { via: 'KTM', until, campusShortName: campus?.shortName, campusId: campus?.id }, now)
    const u = await tx.user.findUniqueOrThrow({ where: { id: d.userId }, select: { email: true, name: true } })
    await enqueueEmail(tx, { to: u.email, template: 'student-approved', payload: { name: u.name, url: appUrl('/search') } })
    return { userId: d.userId, until }
  })
}

/** `reason` is a reject code (KTM_REJECT_REASONS) or, for backward compatibility, free text. `note` is appended to a code's copy. */
export async function rejectDocument(prisma: PrismaClient, id: string, opts: { reviewer: string; reason: string; note?: string }, now: Date = new Date()): Promise<{ userId: string; attempt: number }> {
  const raw = opts.reason.trim()
  if (!raw) throw new ReviewError('Alasan penolakan wajib diisi.')
  const note = opts.note?.trim()
  const reason = isKtmRejectCode(raw) ? `${KTM_REJECT_REASONS[raw]}${note ? ` Catatan: ${note}` : ''}` : raw
  return prisma.$transaction(async (tx) => {
    const d = await tx.studentDocument.findUnique({ where: { id }, select: { userId: true } })
    if (!d) throw new ReviewError('Dokumen tidak ditemukan.')
    const res = await tx.studentDocument.updateMany({
      where: { id, status: 'PENDING', deletedAt: null },
      data: { status: 'REJECTED', decidedAt: now, reviewer: opts.reviewer, reason, deleteAfter: new Date(now.getTime() + KTM_RETENTION_DAYS * DAY) },
    })
    if (res.count !== 1) throw new ReviewError('Hanya dokumen berstatus PENDING yang bisa diputuskan.')
    const attempt = await tx.studentDocument.count({ where: countedRejectionWhere(d.userId) })
    const u = await tx.user.findUniqueOrThrow({ where: { id: d.userId }, select: { email: true, name: true } })
    await enqueueEmail(tx, { to: u.email, template: 'student-rejected', payload: { name: u.name, url: appUrl('/profile'), reason, attempt, max: KTM_MAX_ATTEMPTS } })
    return { userId: d.userId, attempt }
  })
}

/** Operator: gives a student a fresh set of KTM attempts. Old rejections stay as rows (and in the photo retention), but stop counting. */
export async function resetKtmAttempts(prisma: PrismaClient, userId: string): Promise<number> {
  const rows = await prisma.studentDocument.findMany({ where: countedRejectionWhere(userId), select: { id: true, reviewer: true } })
  for (const r of rows) await prisma.studentDocument.update({ where: { id: r.id }, data: { reviewer: `reset:${r.reviewer}` } })
  return rows.length
}
