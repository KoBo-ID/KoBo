import { competes, compareQueue, MAX_LIVE_ENTRIES, queuePosition } from '@kobo/shared/domain'
import { kosIdOnly, ownerWaitlistRemoveInput, waitlistEntryInput, waitlistJoinInput } from '@kobo/shared/schemas'
import type { WaitlistStatus } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import type { Prisma } from '../generated/prisma/client.ts'
import type { Storage } from '../storage.ts'
import { advanceWaitlist, liveOffer } from '../waitlist.ts'
import { authedProcedure, ownerProcedure, publicProcedure, router } from './trpc.ts'

type Tx = Prisma.TransactionClient

export interface WaitlistOffer {
  roomId: string
  roomNumber: string
  priceMonthly: number
  /** ISO timestamp: the offer lapses after this. */
  expiresAt: string
}

export interface MyWaitlistEntry {
  id: string
  status: WaitlistStatus
  /** null = any type */
  roomType: string | null
  /** Queue number; only WAITING entries have one. */
  position: number | null
  createdAt: string
  kos: { id: string; slug: string; name: string; image: string | null }
  offer: WaitlistOffer | null
}

export interface WaitlistStatusResult {
  /** No bookable room at all (every room is taken or reserved by an offer). */
  full: boolean
  /** Each distinct room type with how many WAITING entries compete for it. */
  types: { roomType: string | null; waiting: number }[]
  mine: MyWaitlistEntry | null
}

export interface OwnerWaitlistEntry {
  id: string
  position: number | null
  status: WaitlistStatus
  roomType: string | null
  createdAt: string
  user: { name: string; campus: string | null; image: string | null; campusVerified: boolean }
  offer: { roomNumber: string; expiresAt: string } | null
}

const LIVE = ['WAITING', 'OFFERED'] as const
const HISTORY_LIMIT = 10

const ALREADY_QUEUED = 'Kamu sudah ada di daftar tunggu kos ini.'
const NOT_OWN = 'Anda hanya dapat mengubah antrean Anda sendiri.'
const NOT_LIVE = 'Antrean ini sudah selesai.'

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: unknown } | null
  return !!err && (err.code === 'P2002' || `${err.message ?? ''} ${JSON.stringify(err.meta ?? {})}`.includes('23505'))
}

/** Rooms nobody holds: no ACTIVE tenancy, no unexpired PENDING hold, and no live offer. */
export async function bookableRooms(db: Tx, kosId: string, now: Date): Promise<{ id: string; type: string }[]> {
  return db.room.findMany({
    where: {
      kosId,
      tenancies: { none: { OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gte: now } }] } },
      waitlistOffers: { none: liveOffer(now) },
    },
    select: { id: true, type: true },
  })
}

const entryInclude = {
  kos: { select: { id: true, slug: true, name: true, images: { orderBy: { order: 'asc' }, take: 1, select: { url: true, key: true } } } },
  offeredRoom: { select: { id: true, roomNumber: true, priceMonthly: true } },
} satisfies Prisma.WaitlistEntryInclude
type EntryRow = Prisma.WaitlistEntryGetPayload<{ include: typeof entryInclude }>

/** Shape entries for the student: queue numbers computed on read (ADR 0005); an offer past its deadline reads as EXPIRED. */
async function toMyEntries(db: Tx, storage: Storage, rows: EntryRow[], now: Date): Promise<MyWaitlistEntry[]> {
  const kosIds = [...new Set(rows.map((r) => r.kosId))]
  const waiting = await db.waitlistEntry.findMany({ where: { kosId: { in: kosIds }, status: 'WAITING' }, select: { id: true, kosId: true, roomType: true, createdAt: true } })
  return rows.map((r): MyWaitlistEntry => {
    const lapsed = r.status === 'OFFERED' && (r.offerExpiresAt === null || r.offerExpiresAt < now)
    const status: WaitlistStatus = lapsed ? 'EXPIRED' : r.status
    const img = r.kos.images[0]
    return {
      id: r.id,
      status,
      roomType: r.roomType,
      position: status === 'WAITING' ? queuePosition(r, waiting.filter((w) => w.kosId === r.kosId)) : null,
      createdAt: r.createdAt.toISOString(),
      kos: { id: r.kos.id, slug: r.kos.slug, name: r.kos.name, image: img ? (img.url ?? storage.publicUrl(img.key!)) : null },
      offer:
        status === 'OFFERED' && r.offeredRoom && r.offerExpiresAt
          ? { roomId: r.offeredRoom.id, roomNumber: r.offeredRoom.roomNumber, priceMonthly: r.offeredRoom.priceMonthly, expiresAt: r.offerExpiresAt.toISOString() }
          : null,
    }
  })
}

export const waitlistRouter = router({
  /** Is this kos full, how long is the queue per type, and (signed in) where am I. Public. */
  status: publicProcedure.input(kosIdOnly).query(async ({ ctx, input }): Promise<WaitlistStatusResult> => {
    const now = new Date()
    const [rooms, bookable, waiting, session] = await Promise.all([
      ctx.prisma.room.findMany({ where: { kosId: input.kosId }, select: { type: true } }),
      bookableRooms(ctx.prisma, input.kosId, now),
      ctx.prisma.waitlistEntry.findMany({ where: { kosId: input.kosId, status: 'WAITING' }, select: { roomType: true } }),
      ctx.getSession(),
    ])
    const types = [...new Set(rooms.map((r) => r.type))].sort().map((roomType) => ({ roomType, waiting: waiting.filter((w) => competes(w.roomType, roomType)).length }))
    let mine: MyWaitlistEntry | null = null
    if (session) {
      const row = await ctx.prisma.waitlistEntry.findFirst({ where: { kosId: input.kosId, userId: session.user.id, status: { in: [...LIVE] } }, include: entryInclude })
      if (row) {
        const [entry] = await toMyEntries(ctx.prisma, ctx.storage, [row], now)
        if (entry.status === 'WAITING' || entry.status === 'OFFERED') mine = entry
      }
    }
    return { full: bookable.length === 0, types, mine }
  }),

  /** Join a full kos's queue. Advances the kos first, so a lapsed hold or offer is settled before "is it full?" is decided. */
  join: authedProcedure.input(waitlistJoinInput).mutation(async ({ ctx, input }): Promise<MyWaitlistEntry> => {
    const now = new Date()
    const kos = await ctx.prisma.kos.findUnique({ where: { id: input.kosId }, select: { id: true, owner: { select: { userId: true } } } })
    if (!kos) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kos tidak ditemukan.' })
    if (kos.owner.userId === ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Anda tidak bisa mengantre di kos Anda sendiri.' })
    try {
      return await ctx.prisma.$transaction(async (tx) => {
        await advanceWaitlist(tx, kos.id, now)
        const mine = await tx.waitlistEntry.findMany({ where: { userId: ctx.user.id, status: { in: [...LIVE] } }, select: { kosId: true } })
        if (mine.some((m) => m.kosId === kos.id)) throw new TRPCError({ code: 'CONFLICT', message: ALREADY_QUEUED })
        if (mine.length >= MAX_LIVE_ENTRIES) throw new TRPCError({ code: 'BAD_REQUEST', message: `Kamu hanya bisa mengantre di ${MAX_LIVE_ENTRIES} kos sekaligus.` })
        const rooms = await tx.room.findMany({ where: { kosId: kos.id }, select: { type: true } })
        if (input.roomType !== null && !rooms.some((r) => r.type === input.roomType)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tipe kamar tidak ditemukan di kos ini.' })
        if ((await bookableRooms(tx, kos.id, now)).some((r) => input.roomType === null || r.type === input.roomType)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Masih ada kamar kosong, silakan langsung pesan.' })
        }
        const row = await tx.waitlistEntry.create({ data: { kosId: kos.id, userId: ctx.user.id, roomType: input.roomType }, include: entryInclude })
        return (await toMyEntries(tx, ctx.storage, [row], now))[0]
      })
    } catch (e) {
      if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: ALREADY_QUEUED })
      throw e
    }
  }),

  /** Own WAITING or OFFERED entry. Leaving a live offer passes the room on. */
  leave: authedProcedure.input(waitlistEntryInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    return ctx.prisma.$transaction(async (tx) => {
      const entry = await tx.waitlistEntry.findUnique({ where: { id: input.entryId }, select: { userId: true, kosId: true, status: true } })
      if (!entry || entry.userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: NOT_OWN })
      if (entry.status !== 'WAITING' && entry.status !== 'OFFERED') throw new TRPCError({ code: 'CONFLICT', message: NOT_LIVE })
      const now = new Date()
      const res = await tx.waitlistEntry.updateMany({ where: { id: input.entryId, status: entry.status }, data: { status: 'LEFT', resolvedAt: now } })
      if (res.count === 0) throw new TRPCError({ code: 'CONFLICT', message: NOT_LIVE })
      if (entry.status === 'OFFERED') await advanceWaitlist(tx, entry.kosId, now)
      return { id: input.entryId }
    })
  }),

  /** Turn down an offer. The room goes to the next entry; the place in the queue is gone. */
  decline: authedProcedure.input(waitlistEntryInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    return ctx.prisma.$transaction(async (tx) => {
      const entry = await tx.waitlistEntry.findUnique({ where: { id: input.entryId }, select: { userId: true, kosId: true } })
      if (!entry || entry.userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: NOT_OWN })
      const now = new Date()
      const res = await tx.waitlistEntry.updateMany({ where: { id: input.entryId, status: 'OFFERED' }, data: { status: 'DECLINED', resolvedAt: now } })
      if (res.count === 0) throw new TRPCError({ code: 'CONFLICT', message: 'Penawaran ini sudah tidak berlaku.' })
      await advanceWaitlist(tx, entry.kosId, now)
      return { id: input.entryId }
    })
  }),

  /** Live entries first (offers, then the queue), then the last few resolved ones. */
  mine: authedProcedure.query(async ({ ctx }): Promise<MyWaitlistEntry[]> => {
    const now = new Date()
    const [live, past] = await Promise.all([
      ctx.prisma.waitlistEntry.findMany({ where: { userId: ctx.user.id, status: { in: [...LIVE] } }, include: entryInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      ctx.prisma.waitlistEntry.findMany({ where: { userId: ctx.user.id, status: { notIn: [...LIVE] } }, include: entryInclude, orderBy: [{ resolvedAt: 'desc' }, { id: 'asc' }], take: HISTORY_LIMIT }),
    ])
    const all = await toMyEntries(ctx.prisma, ctx.storage, [...live, ...past], now)
    const rank = (e: MyWaitlistEntry) => (e.status === 'OFFERED' ? 0 : e.status === 'WAITING' ? 1 : 2)
    return all.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e)
  }),
})

/** owner.waitlistEntries: one kos's queue (offers first, then the queue in order, then a few resolved entries). */
export const ownerWaitlistEntries = ownerProcedure.input(kosIdOnly).query(async ({ ctx, input }): Promise<OwnerWaitlistEntry[]> => {
  const include = { user: { select: { name: true, campus: true, image: true, campusEmailVerifiedAt: true } }, offeredRoom: { select: { roomNumber: true } } } satisfies Prisma.WaitlistEntryInclude
  const [live, past] = await Promise.all([
    ctx.prisma.waitlistEntry.findMany({ where: { kosId: input.kosId, status: { in: [...LIVE] } }, include }),
    ctx.prisma.waitlistEntry.findMany({ where: { kosId: input.kosId, status: { notIn: [...LIVE] } }, include, orderBy: [{ resolvedAt: 'desc' }, { id: 'asc' }], take: HISTORY_LIMIT }),
  ])
  const waiting = live.filter((e) => e.status === 'WAITING')
  const shape = (e: (typeof live)[number]): OwnerWaitlistEntry => ({
    id: e.id,
    position: e.status === 'WAITING' ? queuePosition(e, waiting) : null,
    status: e.status,
    roomType: e.roomType,
    createdAt: e.createdAt.toISOString(),
    user: { name: e.user.name, campus: e.user.campus, image: e.user.image, campusVerified: e.user.campusEmailVerifiedAt !== null },
    offer: e.status === 'OFFERED' && e.offeredRoom && e.offerExpiresAt ? { roomNumber: e.offeredRoom.roomNumber, expiresAt: e.offerExpiresAt.toISOString() } : null,
  })
  const ordered = [...live.filter((e) => e.status === 'OFFERED').sort(compareQueue), ...[...waiting].sort(compareQueue)]
  return [...ordered, ...past].map(shape)
})

/** owner.waitlist: the entry is looked up inside the (already authorized) kos, so a foreign entry id is NOT_FOUND. */
export const ownerWaitlistRouter = router({
  remove: ownerProcedure.input(ownerWaitlistRemoveInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    return ctx.prisma.$transaction(async (tx) => {
      const entry = await tx.waitlistEntry.findFirst({ where: { id: input.entryId, kosId: input.kosId }, select: { id: true, status: true } })
      if (!entry) throw new TRPCError({ code: 'NOT_FOUND', message: 'Antrean tidak ditemukan.' })
      if (entry.status !== 'WAITING' && entry.status !== 'OFFERED') throw new TRPCError({ code: 'CONFLICT', message: NOT_LIVE })
      const now = new Date()
      const res = await tx.waitlistEntry.updateMany({ where: { id: entry.id, status: entry.status }, data: { status: 'REMOVED', resolvedAt: now } })
      if (res.count === 0) throw new TRPCError({ code: 'CONFLICT', message: NOT_LIVE })
      if (entry.status === 'OFFERED') await advanceWaitlist(tx, input.kosId, now)
      return { id: entry.id }
    })
  }),
})
