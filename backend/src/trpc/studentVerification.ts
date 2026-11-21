import { randomUUID } from 'node:crypto'
import { isStudentVerified, todayWIB } from '@kobo/shared/domain'
import { ktmConfirmInput, ktmPresignInput, sheeridStartInput } from '@kobo/shared/schemas'
import type { StudentVerificationStatus } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import { HOUR, limiterFor } from '../rateLimit.ts'
import { hasImageSignature, PRESIGN_EXPIRES_SECONDS } from '../storage.ts'
import { SHEERID_CONSENT_VERSION, settleSheerId } from '../sheerid.ts'
import { countedRejectionWhere, getStudentVerificationStatus, KTM_MAX_ATTEMPTS } from '../studentVerification/verifier.ts'
import { authedProcedure, router, type Context } from './trpc.ts'

const KTM_MAX_BYTES = 3_000_000
const KTM_TYPES = ['image/jpeg', 'image/webp'] as const

export interface KtmPresign {
  key: string
  url: string
  headers: Record<string, string>
  expiresInSeconds: number
}

const OUT_OF_ATTEMPTS = 'Percobaan unggah KTM Anda sudah habis. Gunakan Cara lain (email kampus atau akun kampus) atau hubungi KoBo.'
const tooManyRejections = async (ctx: Context & { user: { id: string } }) => (await ctx.prisma.studentDocument.count({ where: countedRejectionWhere(ctx.user.id) })) >= KTM_MAX_ATTEMPTS

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
    if (await tooManyRejections(ctx)) throw new TRPCError({ code: 'FORBIDDEN', message: OUT_OF_ATTEMPTS })
    const key = `private/ktm/${ctx.user.id}/${randomUUID()}.${input.contentType === 'image/webp' ? 'webp' : 'jpg'}`
    const signed = await ctx.storage.presignPrivatePut(key, input.contentType, input.contentLength)
    return { key, url: signed.url, headers: signed.headers, expiresInSeconds: PRESIGN_EXPIRES_SECONDS }
  }),

  /** Trust nothing from the browser: HEAD the object, check type, size and signature, then file a PENDING document. */
  ktmConfirm: authedProcedure.input(ktmConfirmInput).mutation(async ({ ctx, input }): Promise<StudentVerificationStatus> => {
    if ((ctx.user as { isDemo?: boolean }).isDemo === true) throw new TRPCError({ code: 'FORBIDDEN', message: 'Akun demo tidak dapat mengunggah KTM.' })
    const prefix = `private/ktm/${ctx.user.id}/`
    if (!input.key.startsWith(prefix) || input.key.includes('..') || input.key.slice(prefix.length).includes('/')) throw new TRPCError({ code: 'FORBIDDEN', message: 'Kunci berkas tidak valid.' })
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { campusEmailVerifiedAt: true, campusVerifiedUntil: true } })
    if (isStudentVerified(u, new Date())) {
      // Do not keep a card photo the student no longer needs. Only objects that no document row owns are removed.
      if (!(await ctx.prisma.studentDocument.findUnique({ where: { key: input.key }, select: { id: true } }))) await ctx.storage.deletePrivate(input.key)
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Status mahasiswa Anda sudah terverifikasi.' })
    }
    const unowned = async () => {
      if (!(await ctx.prisma.studentDocument.findUnique({ where: { key: input.key }, select: { id: true } }))) await ctx.storage.deletePrivate(input.key)
    }
    if (input.validUntil && input.validUntil < todayWIB(new Date())) {
      await unowned()
      throw bad('Masa berlaku KTM sudah lewat. Gunakan KTM yang masih berlaku atau kartu rencana studi semester ini.')
    }
    if (await tooManyRejections(ctx)) {
      await unowned()
      throw new TRPCError({ code: 'FORBIDDEN', message: OUT_OF_ATTEMPTS })
    }
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
        data: { userId: ctx.user.id, kind: 'KTM', status: 'PENDING', key: input.key, contentType: head.contentType, campusId: input.campusId, nim: input.nim, nameOnCard: input.nameOnCard, claimedValidUntil: input.validUntil ? new Date(`${input.validUntil}T00:00:00.000Z`) : null, program: input.program || null, consentAt: now },
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        // Either a PENDING document exists, or this key already belongs to a document. Delete the new object only in the first case.
        if (!(await ctx.prisma.studentDocument.findUnique({ where: { key: input.key }, select: { id: true } }))) await ctx.storage.deletePrivate(input.key)
        throw new TRPCError({ code: 'CONFLICT', message: 'KTM Anda sedang ditinjau.' })
      }
      throw e
    }
    return getStudentVerificationStatus(ctx.prisma, ctx.user.id, now, providersOf(ctx))
  }),

  /**
   * Deletes every stored photo of the user at once. A PENDING document is closed as withdrawn. Each row is claimed with a
   * conditional update on its current status, so a concurrent approve (which is conditional on PENDING) and this call can
   * never both win: whichever loses sees count 0 and re-reads. The row is only marked deleted after the object is gone;
   * if the storage call fails the row keeps deleteAfter = now and the retention job finishes the job.
   */
  ktmWithdraw: authedProcedure.mutation(async ({ ctx }): Promise<StudentVerificationStatus> => {
    const now = new Date()
    for (let round = 0; round < 3; round++) {
      const docs = await ctx.prisma.studentDocument.findMany({ where: { userId: ctx.user.id, deletedAt: null }, select: { id: true, key: true, status: true }, take: 50 })
      if (docs.length === 0) break
      let raced = false
      for (const d of docs) {
        const claim = await ctx.prisma.studentDocument.updateMany({
          where: { id: d.id, status: d.status, deletedAt: null },
          data: d.status === 'PENDING' ? { status: 'REJECTED', reason: 'Ditarik oleh pengguna', decidedAt: now, deleteAfter: now } : { deleteAfter: now },
        })
        if (claim.count !== 1) {
          raced = true
          continue
        }
        await ctx.storage.deletePrivate(d.key)
        await ctx.prisma.studentDocument.update({ where: { id: d.id }, data: { deletedAt: now } })
      }
      if (!raced) break
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
