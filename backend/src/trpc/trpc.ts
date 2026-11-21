import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'
import type { Auth } from '../auth.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import type { Geocoder } from '../geocode.ts'
import type { PrismaClient } from '../db/client.ts'
import type { PaymentService } from '../payment/service.ts'
import type { RateLimiter } from '../rateLimit.ts'
import type { Storage } from '../storage.ts'
import { assertStudentVerified } from '../studentGate.ts'
import type { SheerIdService } from '../sheerid.ts'

export type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>
export interface Context {
  prisma: PrismaClient
  auth: Auth
  storage: Storage
  paymentService: PaymentService
  geocoder: Geocoder
  /** SheerID (dev/test only; null/absent = off). See backend/src/sheerid.ts. */
  sheerid?: SheerIdService | null
  /** Rate limiter; absent means the shared one (rateLimit.ts). Tests inject their own. */
  limiter?: RateLimiter
  /** Request headers (for forwarding to better-auth). */
  headers: Headers
  /** Response headers the tRPC adapter will send (Set-Cookie from auth-changing procedures). */
  resHeaders: Headers
  /** Lazy and memoised: public queries such as kos.list never pay for a session lookup. */
  getSession: () => Promise<Session | null>
}

export const GENERIC_VALIDATION = 'Data yang dikirim tidak valid. Periksa kembali isian Anda.'
export const GENERIC_ERROR = 'Terjadi kesalahan pada server. Silakan coba lagi.'

/**
 * Spec section 10: deliberate domain errors (explicit TRPCError codes with their own Indonesian message) pass
 * through; validation failures and anything unexpected collapse to one generic Indonesian message so no
 * schema detail, SQL text or stack trace reaches the client.
 */
export function formatTrpcError<S extends { message: string; data: object }>({ shape, error }: { shape: S; error: { code: string; cause?: unknown } }): S {
  const isValidation = error.code === 'BAD_REQUEST' && Array.isArray((error.cause as { issues?: unknown } | undefined)?.issues)
  const isUnknown = error.code === 'INTERNAL_SERVER_ERROR'
  if (!isValidation && !isUnknown) return shape
  const { stack: _stack, ...data } = shape.data as Record<string, unknown>
  return { ...shape, message: isValidation ? GENERIC_VALIDATION : GENERIC_ERROR, data } as S
}

const t = initTRPC.context<Context>().create({ errorFormatter: formatTrpcError })

export const router = t.router
export const publicProcedure = t.procedure
export const createCallerFactory = t.createCallerFactory

/** Requires a signed-in user; exposes it as ctx.user. */
export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const session = await ctx.getSession()
  if (!session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Silakan masuk terlebih dahulu.' })
  const user = session.user as typeof session.user & { isDemo?: boolean }
  return next({ ctx: { ...ctx, user, paymentProvider: ctx.paymentService.providerFor({ isDemo: user.isDemo === true }) } })
})

/**
 * Signed-in AND a currently verified student (when REQUIRE_STUDENT_VERIFICATION is on). Only for new rental starts
 * (application.create, visit.create, waitlist.join).
 *
 * A-005: the kos the student targets (input `kosId`, or the kos of input `roomId`) must belong to an approved owner, the same rule
 * that hides unapproved owners from search. Unknown ids fall through so each procedure keeps its own NOT_FOUND message.
 */
export const studentProcedure = authedProcedure.use(async ({ ctx, next, getRawInput }) => {
  await assertStudentVerified(ctx.prisma, ctx.user.id, new Date())
  const raw = (await getRawInput()) as Record<string, unknown> | null | undefined
  const notApproved = { owner: { verificationStatus: { not: 'DISETUJUI' as const } } }
  // Every rental input key a student procedure can receive, mapped to the kos filter it implies.
  const filters: Record<(typeof STUDENT_KOS_KEYS)[number], (id: string) => Prisma.KosWhereInput> = {
    kosId: (id) => ({ id }),
    roomId: (id) => ({ rooms: { some: { id } } }),
    applicationId: (id) => ({ rooms: { some: { rentalApplications: { some: { id } } } } }),
    visitId: (id) => ({ visits: { some: { id } } }),
    waitlistEntryId: (id) => ({ waitlist: { some: { id } } }),
    invoiceId: (id) => ({ rooms: { some: { tenancies: { some: { invoices: { some: { id } } } } } } }),
    tenancyId: (id) => ({ rooms: { some: { tenancies: { some: { id } } } } }),
    paymentId: (id) => ({ rooms: { some: { tenancies: { some: { invoices: { some: { payments: { some: { id } } } } } } } } }),
  }
  const present = STUDENT_KOS_KEYS.filter((k) => typeof raw?.[k] === 'string' && (raw[k] as string).length > 0)
  // Fail closed: an input that names no kos-bearing key cannot be checked against the owner's approval.
  if (present.length === 0) throw new TRPCError({ code: 'FORBIDDEN', message: 'Permintaan tidak dapat diproses.' })
  for (const key of present) {
    const unapproved = await ctx.prisma.kos.findFirst({ where: { AND: [filters[key](raw![key] as string), notApproved] }, select: { id: true } })
    if (unapproved) throw new TRPCError({ code: 'NOT_FOUND', message: key === 'roomId' ? 'Kamar tidak ditemukan.' : 'Kos tidak ditemukan.' })
  }
  return next()
})

/** Input keys studentProcedure resolves to a kos. Exported for the table-driven test. */
export const STUDENT_KOS_KEYS = ['kosId', 'roomId', 'applicationId', 'visitId', 'waitlistEntryId', 'invoiceId', 'tenancyId', 'paymentId'] as const

/** Thrown by owner.kos.create for an owner whose documents are not approved. The UI detects it by this exact prefix. */
export const OWNER_UNVERIFIED_MESSAGE = 'Akun pemilik belum terverifikasi. Unggah KTP dan dokumen tanah, lalu tunggu persetujuan tim KoBo sebelum mendaftarkan kos.'

/**
 * For owner procedures that have no kos yet (listing and creating). Requires an OwnerProfile; exposes
 * ctx.ownerProfileId and ctx.isDemo. Anything scoped to an existing kos uses ownerProcedure instead.
 */
export const ownerOnlyProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const owner = await ctx.prisma.ownerProfile.findUnique({ where: { userId: ctx.user.id }, select: { id: true, verificationStatus: true, user: { select: { isDemo: true } } } })
  if (!owner) throw new TRPCError({ code: 'FORBIDDEN', message: 'Fitur ini khusus pemilik kos.' })
  return next({ ctx: { ...ctx, ownerProfileId: owner.id, isDemo: owner.user.isDemo, ownerVerified: owner.verificationStatus === 'DISETUJUI' } })
})

const kosIdInput = z.object({ kosId: z.string().min(1) })

/**
 * The authorization root for every owner write (spec section 5): the input MUST carry a `kosId`, and that
 * kos must belong to the caller's OwnerProfile. Unknown and foreign kos ids are indistinguishable (both
 * FORBIDDEN) so ids cannot be probed. Exposes ctx.ownerProfileId.
 */
export const ownerProcedure = authedProcedure.use(async ({ ctx, next, getRawInput }) => {
  const parsed = kosIdInput.safeParse(await getRawInput())
  if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST', message: 'kosId wajib diisi.' })
  const owner = await ctx.prisma.ownerProfile.findUnique({ where: { userId: ctx.user.id }, select: { id: true } })
  const kos = owner ? await ctx.prisma.kos.findUnique({ where: { id: parsed.data.kosId }, select: { ownerId: true } }) : null
  if (!owner || !kos || kos.ownerId !== owner.id) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Anda tidak memiliki akses ke kos ini.' })
  }
  return next({ ctx: { ...ctx, ownerProfileId: owner.id } })
})
