import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'
import type { Auth } from '../auth.ts'
import type { PrismaClient } from '../db/client.ts'
import type { Storage } from '../storage.ts'

export type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

export interface Context {
  prisma: PrismaClient
  auth: Auth
  storage: Storage
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
  return next({ ctx: { ...ctx, user: session.user } })
})

/**
 * For owner procedures that have no kos yet (listing and creating). Requires an OwnerProfile; exposes
 * ctx.ownerProfileId and ctx.isDemo. Anything scoped to an existing kos uses ownerProcedure instead.
 */
export const ownerOnlyProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const owner = await ctx.prisma.ownerProfile.findUnique({ where: { userId: ctx.user.id }, select: { id: true, user: { select: { isDemo: true } } } })
  if (!owner) throw new TRPCError({ code: 'FORBIDDEN', message: 'Fitur ini khusus pemilik kos.' })
  return next({ ctx: { ...ctx, ownerProfileId: owner.id, isDemo: owner.user.isDemo } })
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
