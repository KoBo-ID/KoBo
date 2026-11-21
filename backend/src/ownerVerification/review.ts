import type { OwnerDocKind } from '@kobo/shared/schemas'
import type { PrismaClient } from '../db/client.ts'
import { enqueueEmail } from '../outbox.ts'
import type { Storage } from '../storage.ts'
import { OWNER_DOC_RETENTION_DAYS } from './documents.ts'

const DAY = 86_400_000
const SHOW_URL_SECONDS = 120

export class ReviewError extends Error {}

/** Reject codes and the Indonesian reason the owner sees. */
export const OWNER_REJECT_REASONS = {
  KTP_BURAM: 'Foto KTP buram atau tidak terbaca. Unggah ulang KTP dengan foto yang jelas.',
  NAMA_TIDAK_SAMA: 'Nama di KTP tidak sama dengan nama di dokumen kepemilikan.',
  DOKUMEN_TIDAK_SESUAI: 'Dokumen kepemilikan tidak sesuai atau tidak dapat dipakai sebagai bukti.',
  KUASA_TIDAK_ADA: 'Surat kuasa dari pemilik belum ada atau tidak valid.',
} as const
export type OwnerRejectCode = keyof typeof OWNER_REJECT_REASONS
export const isRejectCode = (v: string): v is OwnerRejectCode => Object.hasOwn(OWNER_REJECT_REASONS, v)

/** Documents a code points at when the operator names none. Empty intersection with the pending set means all of them. */
const DEFAULT_KINDS: Partial<Record<OwnerRejectCode, OwnerDocKind[]>> = { KTP_BURAM: ['KTP'], KUASA_TIDAK_ADA: ['SURAT_KUASA'] }

const dashboardUrl = () => `${(process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')}/owner/dashboard`

export interface PendingOwnerRow {
  userId: string
  since: Date
  email: string
  name: string
  ownershipType: string | null
  attempts: number
  kinds: string[]
}

export async function listPendingOwners(prisma: PrismaClient): Promise<PendingOwnerRow[]> {
  const rows = await prisma.ownerProfile.findMany({
    where: { verificationStatus: 'MENUNGGU' },
    take: 200,
    select: {
      userId: true,
      ownershipType: true,
      verificationAttempts: true,
      user: { select: { email: true, name: true } },
    },
  })
  const docs = await prisma.ownerDocument.findMany({ where: { userId: { in: rows.map((r) => r.userId) }, status: 'PENDING', deletedAt: null }, select: { userId: true, kind: true, createdAt: true } })
  const out = rows.map((r) => {
    const mine = docs.filter((d) => d.userId === r.userId)
    const since = mine.reduce((min, d) => (d.createdAt < min ? d.createdAt : min), mine[0]?.createdAt ?? new Date(0))
    return { userId: r.userId, since, email: r.user.email, name: r.user.name, ownershipType: r.ownershipType, attempts: r.verificationAttempts, kinds: mine.map((d) => d.kind) }
  })
  return out.sort((a, b) => a.since.getTime() - b.since.getTime())
}

export interface ShownOwner {
  userId: string
  name: string
  email: string
  status: string
  ownershipType: string | null
  attempts: number
  documents: { kind: string; status: string; createdAt: Date; url: string }[]
}

/** Operator-only: a 120 s read URL per stored document. */
export async function showOwner(prisma: PrismaClient, storage: Storage, userId: string): Promise<ShownOwner> {
  const p = await prisma.ownerProfile.findUnique({ where: { userId }, select: { verificationStatus: true, ownershipType: true, verificationAttempts: true, user: { select: { name: true, email: true } } } })
  if (!p) throw new ReviewError('Pemilik tidak ditemukan.')
  const docs = await prisma.ownerDocument.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' } })
  const documents = await Promise.all(docs.map(async (d) => ({ kind: d.kind, status: d.status, createdAt: d.createdAt, url: await storage.presignPrivateGet(d.key, SHOW_URL_SECONDS) })))
  return { userId, name: p.user.name, email: p.user.email, status: p.verificationStatus, ownershipType: p.ownershipType, attempts: p.verificationAttempts, documents }
}

type Db = Pick<PrismaClient, 'ownerProfile'>

async function owner(db: Db, userId: string) {
  const p = await db.ownerProfile.findUnique({ where: { userId }, select: { id: true, user: { select: { name: true, email: true } } } })
  if (!p) throw new ReviewError('Pemilik tidak ditemukan.')
  return p
}

export async function approveOwner(prisma: PrismaClient, userId: string, opts: { reviewer: string }, now: Date = new Date()): Promise<{ userId: string }> {
  return prisma.$transaction(async (tx) => {
    const p = await owner(tx, userId)
    // Conditional update: a concurrent decision (or the auto-review worker) leaves count 0.
    const res = await tx.ownerProfile.updateMany({ where: { userId, verificationStatus: 'MENUNGGU' }, data: { verificationStatus: 'DISETUJUI', verificationReason: null } })
    if (res.count !== 1) throw new ReviewError('Hanya pemilik berstatus MENUNGGU yang bisa diputuskan.')
    await tx.ownerProfile.updateMany({ where: { userId, approvedAt: null }, data: { approvedAt: now } })
    await tx.ownerDocument.updateMany({ where: { userId, status: 'PENDING', deletedAt: null }, data: { status: 'APPROVED', decidedAt: now, reviewer: opts.reviewer } })
    await tx.ownerDocument.updateMany({ where: { userId, deletedAt: null }, data: { deleteAfter: new Date(now.getTime() + OWNER_DOC_RETENTION_DAYS * DAY) } })
    await enqueueEmail(tx, { to: p.user.email, template: 'owner-approved', payload: { name: p.user.name, url: dashboardUrl() } })
    return { userId }
  })
}

export async function rejectOwner(
  prisma: PrismaClient,
  userId: string,
  opts: { reviewer: string; code: OwnerRejectCode; note?: string; kinds?: OwnerDocKind[] },
  now: Date = new Date(),
): Promise<{ userId: string }> {
  if (!isRejectCode(opts.code)) throw new ReviewError(`Kode tidak dikenal. Pilih salah satu: ${Object.keys(OWNER_REJECT_REASONS).join(', ')}.`)
  const note = opts.note?.trim().slice(0, 300)
  const reason = note ? `${OWNER_REJECT_REASONS[opts.code]} Catatan: ${note}` : OWNER_REJECT_REASONS[opts.code]
  return prisma.$transaction(async (tx) => {
    const p = await owner(tx, userId)
    const res = await tx.ownerProfile.updateMany({ where: { userId, verificationStatus: 'MENUNGGU' }, data: { verificationStatus: 'DITOLAK', verificationReason: reason } })
    if (res.count !== 1) throw new ReviewError('Hanya pemilik berstatus MENUNGGU yang bisa diputuskan.')
    const pending = await tx.ownerDocument.findMany({ where: { userId, status: 'PENDING', deletedAt: null }, select: { id: true, kind: true } })
    const wanted = opts.kinds ?? DEFAULT_KINDS[opts.code] ?? []
    const rejected = pending.filter((d) => wanted.includes(d.kind))
    // No kind named (or none of them pending): the whole submission is rejected.
    const rejectIds = (rejected.length > 0 ? rejected : pending).map((d) => d.id)
    await tx.ownerDocument.updateMany({ where: { id: { in: rejectIds } }, data: { status: 'REJECTED', decidedAt: now, reviewer: opts.reviewer, reason: opts.code } })
    await tx.ownerDocument.updateMany({ where: { userId, status: 'PENDING', deletedAt: null }, data: { status: 'APPROVED', decidedAt: now, reviewer: opts.reviewer } })
    await tx.ownerDocument.updateMany({ where: { userId, deletedAt: null }, data: { deleteAfter: new Date(now.getTime() + OWNER_DOC_RETENTION_DAYS * DAY) } })
    await enqueueEmail(tx, { to: p.user.email, template: 'owner-rejected', payload: { name: p.user.name, url: dashboardUrl() } })
    return { userId }
  })
}

/** Gives the owner a fresh set of attempts (after the third rejection, or by exception). */
export async function resetOwner(prisma: PrismaClient, userId: string): Promise<void> {
  const res = await prisma.ownerProfile.updateMany({ where: { userId }, data: { verificationAttempts: 0 } })
  if (res.count !== 1) throw new ReviewError('Pemilik tidak ditemukan.')
}
