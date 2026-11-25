import { randomUUID } from 'node:crypto'
import { ownerDocPresignInput, ownerDocSubmitInput, type OwnerDocKind } from '@kobo/shared/schemas'
import type { OwnerDocPresign, OwnerVerificationState } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import { HOUR, limiterFor } from '../rateLimit.ts'
import { PRESIGN_EXPIRES_SECONDS } from '../storage.ts'
import { hasOwnerDocSignature, isOwnKey, OWNER_DOC_MAX_BYTES, OWNER_DOC_TYPES, OWNER_KEY_PREFIX, OWNER_MAX_ATTEMPTS, ownerDocsProblem } from '../ownerVerification/documents.ts'
import type { PrismaClient } from '../db/client.ts'
import { ownerOnlyProcedure, router } from './trpc.ts'

const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message })

const submitInput = ownerDocSubmitInput

async function stateOf(prisma: PrismaClient, userId: string): Promise<OwnerVerificationState> {
  const p = await prisma.ownerProfile.findUniqueOrThrow({ where: { userId }, select: { verificationStatus: true, verificationReason: true, verificationAttempts: true, ownershipType: true } })
  const rows = await prisma.ownerDocument.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { kind: true, status: true, createdAt: true } })
  // Newest document per kind: an older REJECTED row is history once the owner has replaced it.
  const latest = new Map<OwnerDocKind, (typeof rows)[number]>()
  for (const r of rows) latest.set(r.kind, r)
  return {
    status: p.verificationStatus,
    ownershipType: p.ownershipType === 'PENGELOLA_KUASA' || p.ownershipType === 'LAINNYA' ? p.ownershipType : 'PEMILIK',
    reason: p.verificationStatus === 'DITOLAK' ? p.verificationReason : null,
    attemptsLeft: Math.max(0, OWNER_MAX_ATTEMPTS - p.verificationAttempts),
    slaText: 'Pemeriksaan maks. 2×24 jam kerja',
    documents: [...latest.values()].map((r) => ({ kind: r.kind, status: r.status, createdAt: r.createdAt.toISOString() })),
  }
}

export const ownerVerificationRouter = router({
  status: ownerOnlyProcedure.query(({ ctx }): Promise<OwnerVerificationState> => stateOf(ctx.prisma, ctx.user.id)),

  /** A short-lived presigned PUT into the private bucket. The key is built here, never by the browser. */
  presign: ownerOnlyProcedure.input(ownerDocPresignInput).mutation(async ({ ctx, input }): Promise<OwnerDocPresign> => {
    limiterFor(ctx).check(`owner-doc-presign:${ctx.user.id}`, 30, HOUR, 'Terlalu banyak unggahan dokumen. Coba lagi dalam satu jam.')
    const p = await ctx.prisma.ownerProfile.findUniqueOrThrow({ where: { userId: ctx.user.id }, select: { verificationStatus: true } })
    if (p.verificationStatus === 'MENUNGGU') throw new TRPCError({ code: 'CONFLICT', message: 'Dokumen Anda sedang ditinjau.' })
    if (p.verificationStatus === 'DISETUJUI') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Akun pemilik Anda sudah terverifikasi.' })
    const key = `${OWNER_KEY_PREFIX(ctx.user.id)}${randomUUID()}`
    const signed = await ctx.storage.presignPrivatePut(key, input.contentType, input.contentLength)
    return { key, url: signed.url, headers: signed.headers, expiresInSeconds: PRESIGN_EXPIRES_SECONDS }
  }),

  /** Trust nothing from the browser: HEAD and peek each object, then file the documents and move to MENUNGGU in one transaction. */
  submit: ownerOnlyProcedure.input(submitInput).mutation(async ({ ctx, input }): Promise<OwnerVerificationState> => {
    const userId = ctx.user.id
    const docs = input.documents
    if (new Set(docs.map((d) => d.key)).size !== docs.length || new Set(docs.map((d) => d.kind)).size !== docs.length) throw bad('Setiap jenis dokumen hanya boleh dikirim sekali.')
    if (docs.some((d) => !isOwnKey(userId, d.key))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Kunci berkas tidak valid.' })

    const p = await ctx.prisma.ownerProfile.findUniqueOrThrow({ where: { userId }, select: { verificationStatus: true, verificationAttempts: true, ownershipType: true } })
    if (p.verificationStatus === 'MENUNGGU') throw new TRPCError({ code: 'CONFLICT', message: 'Dokumen Anda sedang ditinjau.' })
    if (p.verificationStatus === 'DISETUJUI') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Akun pemilik Anda sudah terverifikasi.' })
    if (p.verificationAttempts >= OWNER_MAX_ATTEMPTS) throw new TRPCError({ code: 'FORBIDDEN', message: 'Batas pengiriman dokumen sudah tercapai. Hubungi tim KoBo untuk bantuan.' })

    // Documents approved in an earlier round stay; the rest must come with this submission.
    const kept = await ctx.prisma.ownerDocument.findMany({ where: { userId, status: 'APPROVED', deletedAt: null }, select: { kind: true } })
    const keptKinds = new Set(kept.map((k) => k.kind))
    if (docs.some((d) => keptKinds.has(d.kind))) throw bad('Dokumen yang sudah disetujui tidak perlu dikirim ulang.')
    const problem = ownerDocsProblem(p.ownershipType, new Set<OwnerDocKind>([...keptKinds, ...docs.map((d) => d.kind)]))
    if (problem) throw bad(problem)

    const heads: { kind: OwnerDocKind; key: string; contentType: string }[] = []
    for (const d of docs) {
      const owned = await ctx.prisma.ownerDocument.findUnique({ where: { key: d.key }, select: { id: true } })
      if (owned) throw new TRPCError({ code: 'FORBIDDEN', message: 'Kunci berkas tidak valid.' })
      const head = await ctx.storage.headPrivate(d.key)
      if (!head) throw bad('Dokumen belum terunggah. Silakan coba unggah ulang.')
      const reject = async (message: string) => {
        await ctx.storage.deletePrivate(d.key)
        return bad(message)
      }
      if (!(OWNER_DOC_TYPES as readonly string[]).includes(head.contentType)) throw await reject('Jenis file tidak didukung. Gunakan gambar (JPG, PNG, WebP, HEIC) atau PDF.')
      if (head.contentLength <= 0 || head.contentLength > OWNER_DOC_MAX_BYTES) throw await reject('Ukuran dokumen melebihi batas 10 MB.')
      const first = await ctx.storage.peekPrivate(d.key, 16)
      if (!first || !hasOwnerDocSignature(head.contentType, first)) throw await reject('Isi file bukan gambar atau PDF yang valid.')
      heads.push({ kind: d.kind, key: d.key, contentType: head.contentType })
    }

    const now = new Date()
    try {
      await ctx.prisma.$transaction(async (tx) => {
        // The conditional update is the race guard: two submits, or a submit racing a decision, leave count 0 for the loser.
        const claim = await tx.ownerProfile.updateMany({
          where: { userId, verificationStatus: { in: ['BELUM_KIRIM', 'DITOLAK'] }, verificationAttempts: { lt: OWNER_MAX_ATTEMPTS } },
          data: { verificationStatus: 'MENUNGGU', verificationReason: null, verificationAttempts: { increment: 1 } },
        })
        if (claim.count !== 1) throw new TRPCError({ code: 'CONFLICT', message: 'Dokumen Anda sedang ditinjau atau batas pengiriman sudah tercapai.' })
        await tx.ownerDocument.createMany({ data: heads.map((h) => ({ userId, kind: h.kind, key: h.key, contentType: h.contentType, status: 'PENDING' as const, consentAt: now })) })
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new TRPCError({ code: 'CONFLICT', message: 'Dokumen ini sudah pernah dikirim.' })
      throw e
    }
    return stateOf(ctx.prisma, userId)
  }),
})
