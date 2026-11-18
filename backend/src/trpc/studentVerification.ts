import { randomUUID } from 'node:crypto'
import { isStudentVerified } from '@kobo/shared/domain'
import { ktmConfirmInput, ktmPresignInput, sheeridStartInput } from '@kobo/shared/schemas'
import type { StudentVerificationStatus } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import { HOUR, limiterFor } from '../rateLimit.ts'
import { hasImageSignature, PRESIGN_EXPIRES_SECONDS } from '../storage.ts'
import { SHEERID_CONSENT_VERSION, settleSheerId } from '../sheerid.ts'
import { getStudentVerificationStatus } from '../studentVerification/verifier.ts'
import { authedProcedure, router, type Context } from './trpc.ts'

const KTM_MAX_BYTES = 3_000_000
const KTM_TYPES = ['image/jpeg', 'image/webp'] as const

export interface KtmPresign {
  key: string
  url: string
  headers: Record<string, string>
  expiresInSeconds: number
}

const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message })

const providersOf = (ctx: Context): StudentVerificationStatus['providers'] => ({ ...ctx.auth.campusIdpProviders, sheerid: !!ctx.sheerid })

export interface SheerIdStart {
  /** SheerID's hosted form for this verification; the browser navigates here. */
  url: string
}

export const studentVerificationRouter = router({
  status: authedProcedure.query(({ ctx }): Promise<StudentVerificationStatus> => getStudentVerificationStatus(ctx.prisma, ctx.user.id, new Date(), providersOf(ctx))),

  /** A short-lived presigned PUT into the private bucket. The key is built here, never by the browser. */
  ktmPresign: authedProcedure.input(ktmPresignInput).mutation(async ({ ctx, input }): Promise<KtmPresign> => {
    if ((ctx.user as { isDemo?: boolean }).isDemo === true) throw new TRPCError({ code: 'FORBIDDEN', message: 'Akun demo tidak dapat mengunggah KTM.' })
    limiterFor(ctx).check(`ktm-presign:${ctx.user.id}`, 10, HOUR, 'Terlalu banyak unggahan KTM. Coba lagi dalam satu jam.')
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { campusEmailVerifiedAt: true, campusVerifiedUntil: true } })
    if (isStudentVerified(u, new Date())) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Status mahasiswa Anda sudah terverifikasi.' })
    if (await ctx.prisma.studentDocument.findFirst({ where: { userId: ctx.user.id, status: 'PENDING', deletedAt: null }, select: { id: true } })) {
      throw new TRPCError({ code: 'CONFLICT', message: 'KTM Anda sedang ditinjau.' })
    }
    const key = `private/ktm/${ctx.user.id}/${randomUUID()}.${input.contentType === 'image/webp' ? 'webp' : 'jpg'}`
    const signed = await ctx.storage.presignPrivatePut(key, input.contentType, input.contentLength)
    return { key, url: signed.url, headers: signed.headers, expiresInSeconds: PRESIGN_EXPIRES_SECONDS }
  }),

  /** Trust nothing from the browser: HEAD the object, check type, size and signature, then file a PENDING document. */
  ktmConfirm: authedProcedure.input(ktmConfirmInput).mutation(async ({ ctx, input }): Promise<StudentVerificationStatus> => {
    if ((ctx.user as { isDemo?: boolean }).isDemo === true) throw new TRPCError({ code: 'FORBIDDEN', message: 'Akun demo tidak dapat mengunggah KTM.' })
    const prefix = `private/ktm/${ctx.user.id}/`
    if (!input.key.startsWith(prefix) || input.key.includes('..') || input.key.slice(prefix.length).includes('/')) throw new TRPCError({ code: 'FORBIDDEN', message: 'Kunci berkas tidak valid.' })
    const campus = await ctx.prisma.campus.findUnique({ where: { id: input.campusId }, select: { id: true } })
    if (!campus) throw bad('Kampus tidak ditemukan.')
    const head = await ctx.storage.headPrivate(input.key)
    if (!head) throw bad('Foto KTM belum terunggah. Silakan coba unggah ulang.')
    if (!(KTM_TYPES as readonly string[]).includes(head.contentType)) {
      await ctx.storage.deletePrivate(input.key)
      throw bad('Jenis file tidak didukung. Gunakan JPEG atau WebP.')
    }
    if (head.contentLength <= 0 || head.contentLength > KTM_MAX_BYTES) {
      await ctx.storage.deletePrivate(input.key)
      throw bad('Ukuran foto melebihi batas 3 MB.')
    }
    const first = await ctx.storage.peekPrivate(input.key, 16)
    if (!first || !hasImageSignature(head.contentType, first)) {
      await ctx.storage.deletePrivate(input.key)
      throw bad('Isi file bukan foto yang valid. Gunakan JPEG atau WebP.')
    }
    const now = new Date()
    try {
      await ctx.prisma.studentDocument.create({
        data: { userId: ctx.user.id, kind: 'KTM', status: 'PENDING', key: input.key, contentType: head.contentType, campusId: input.campusId, nim: input.nim, nameOnCard: input.nameOnCard, consentAt: now },
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new TRPCError({ code: 'CONFLICT', message: 'KTM Anda sedang ditinjau.' })
      throw e
    }
    return getStudentVerificationStatus(ctx.prisma, ctx.user.id, now, providersOf(ctx))
  }),

  /** Deletes the stored photo at once. A PENDING document is closed as withdrawn. */
  ktmWithdraw: authedProcedure.mutation(async ({ ctx }): Promise<StudentVerificationStatus> => {
    const now = new Date()
    const doc =
      (await ctx.prisma.studentDocument.findFirst({ where: { userId: ctx.user.id, status: 'PENDING', deletedAt: null }, select: { id: true, key: true, status: true } })) ??
      (await ctx.prisma.studentDocument.findFirst({ where: { userId: ctx.user.id, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, key: true, status: true } }))
    if (doc) {
      await ctx.storage.deletePrivate(doc.key)
      await ctx.prisma.studentDocument.update({
        where: { id: doc.id },
        data: doc.status === 'PENDING' ? { deletedAt: now, status: 'REJECTED', reason: 'Ditarik oleh pengguna', decidedAt: now } : { deletedAt: now },
      })
    }
    return getStudentVerificationStatus(ctx.prisma, ctx.user.id, now, providersOf(ctx))
  }),
  /**
   * SheerID, DEV/TEST ONLY (sheerIdEnv refuses production). Creates a verification at SheerID and returns its hosted form.
   * KoBo sends SheerID only its programId; the student types their details on SheerID's form (Test Mode: fake names).
   */
  sheeridStart: authedProcedure.input(sheeridStartInput).mutation(async ({ ctx, input }): Promise<SheerIdStart> => {
    if (!ctx.sheerid) throw new TRPCError({ code: 'NOT_FOUND', message: 'Verifikasi SheerID tidak aktif.' })
    if ((ctx.user as { isDemo?: boolean }).isDemo === true) throw new TRPCError({ code: 'FORBIDDEN', message: 'Akun demo tidak dapat memakai SheerID.' })
    limiterFor(ctx).check(`sheerid-start:${ctx.user.id}`, 5, HOUR, 'Terlalu banyak percobaan SheerID. Coba lagi dalam satu jam.')
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { campusEmailVerifiedAt: true, campusVerifiedUntil: true } })
    if (isStudentVerified(u, new Date())) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Status mahasiswa Anda sudah terverifikasi.' })
    const campus = await ctx.prisma.campus.findUnique({ where: { id: input.campusId }, select: { id: true } })
    if (!campus) throw bad('Kampus tidak ditemukan.')
    let verificationId: string
    try {
      verificationId = (await ctx.sheerid.client.createVerification()).verificationId
    } catch {
      throw new TRPCError({ code: 'BAD_GATEWAY', message: 'SheerID sedang tidak dapat dihubungi. Coba lagi nanti.' })
    }
    await ctx.prisma.sheerIdVerification.create({
      data: { userId: ctx.user.id, verificationId, campusId: campus.id, consentVersion: SHEERID_CONSENT_VERSION, consentAt: new Date() },
    })
    return { url: ctx.sheerid.client.formUrl(verificationId) }
  }),

  /** Called when the student returns from SheerID's form: re-reads the latest open verification and records a final result. */
  sheeridRefresh: authedProcedure.mutation(async ({ ctx }): Promise<StudentVerificationStatus> => {
    if (!ctx.sheerid) throw new TRPCError({ code: 'NOT_FOUND', message: 'Verifikasi SheerID tidak aktif.' })
    limiterFor(ctx).check(`sheerid-refresh:${ctx.user.id}`, 30, HOUR, 'Terlalu sering memeriksa status. Coba lagi nanti.')
    const open = await ctx.prisma.sheerIdVerification.findFirst({ where: { userId: ctx.user.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, select: { verificationId: true } })
    if (open) {
      try {
        await settleSheerId(ctx.prisma, ctx.sheerid.client, open.verificationId)
      } catch {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'SheerID sedang tidak dapat dihubungi. Coba lagi nanti.' })
      }
    }
    return getStudentVerificationStatus(ctx.prisma, ctx.user.id, new Date(), providersOf(ctx))
  }),
})
