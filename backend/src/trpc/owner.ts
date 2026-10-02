import { randomUUID } from 'node:crypto'
import { haversineMeters } from '@kobo/shared/domain'
import { idInput, kosCreateInput, kosIdOnly, kosUpdateInput, roomCreateInput, roomDeleteInput, roomUpdateInput, tenancyEndInput } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '../db/client.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { loadBoardRooms, loadBoardSummary } from '../ownerBoard.ts'
import type { BoardRoom, BoardSummary } from '../ownerBoard.ts'
import type { KosCard, OwnerPublic } from './kos.ts'
import { queryCards } from './kosQueries.ts'
import { ownerImageRouter } from './ownerImages.ts'
import type { OwnerImage } from './ownerImages.ts'
import { ownerVisitRouter, ownerVisits } from './visit.ts'
import { ownerWaitlistEntries, ownerWaitlistRouter } from './waitlist.ts'
import { advanceWaitlist, liveOffer } from '../waitlist.ts'
import { authedProcedure, ownerOnlyProcedure, ownerProcedure, publicProcedure, router } from './trpc.ts'

export type { BoardRoom, BoardSummary } from '../ownerBoard.ts'
export type { ImagePresign, OwnerImage } from './ownerImages.ts'

export interface OwnerReview {
  id: string
  rating: number
  subRatings: { cleanliness: number | null; wifi: number | null; owner: number | null; quietness: number | null }
  comment: string
  createdAt: string
  authorName: string
  authorCampus: string | null
  authorAvatar: string | null
  verified: boolean
  ownerReply: { text: string; at: string | null } | null
}

/** A kos is only linked to a campus when one is this close; "700 km to the nearest campus" is noise. */
export const NEAREST_CAMPUS_MAX_METERS = 10_000

export interface OwnerPublicProfile {
  owner: OwnerPublic
  /** The owner's kos as cards (same shape as kos.list), oldest first. */
  kos: KosCard[]
}

export interface OwnerKos {
  id: string
  slug: string
  name: string
  gender: 'CAMPUR' | 'PUTRA' | 'PUTRI'
  address: string
  district: string
  city: string
  lat: number
  lng: number
  electricityType: 'INCLUDED' | 'TOKEN'
  privateAmenities: string[]
  sharedAmenities: string[]
  studentDiscountAmount: number
  image: string | null
  nearestCampus: { id: string; shortName: string; meters: number | null } | null
  totalRooms: number
  /** Rooms that are not vacant. */
  occupiedRooms: number
  rooms: BoardRoom[]
}

export interface OwnerBoard {
  rooms: BoardRoom[]
  summary: BoardSummary
}

/** A tenancy that still holds its room: ACTIVE, or PENDING and not yet expired (an expired hold reads as vacant). */
const live = (now: Date): Prisma.TenancyWhereInput => ({ OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gte: now } }] })

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: unknown } | null
  if (!err) return false
  return err.code === 'P2002' || `${err.message ?? ''} ${JSON.stringify(err.meta ?? {})}`.includes('23505')
}

async function nearestCampus(prisma: PrismaClient, lat: number, lng: number): Promise<{ nearestCampusId: string | null; nearestCampusMeters: number | null }> {
  const campuses = await prisma.campus.findMany({ select: { id: true, lat: true, lng: true } })
  let best: { id: string; d: number } | null = null
  for (const c of campuses) {
    const d = haversineMeters({ lat, lng }, { lat: c.lat, lng: c.lng })
    if (!best || d < best.d) best = { id: c.id, d }
  }
  return best && best.d <= NEAREST_CAMPUS_MAX_METERS ? { nearestCampusId: best.id, nearestCampusMeters: best.d } : { nearestCampusId: null, nearestCampusMeters: null }
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'kos'

const ROOM_TAKEN = 'Nomor kamar ini sudah dipakai di kos ini.'
const OFFER_ACTIVE = 'Masih ada penawaran daftar tunggu aktif.'

export const ownerRouter = router({
  /**
   * Self-serve owner onboarding: a signed-in user gets an OwnerProfile (spec section 3: "is owner" is exactly
   * `ownerProfile != null`). Idempotent: the unique userId plus upsert makes a double click harmless.
   * Demo accounts are pre-seeded and read-only, so they are refused.
   */
  becomeOwner: authedProcedure.mutation(async ({ ctx }): Promise<{ ownerProfileId: string }> => {
    const user = await ctx.prisma.user.findUnique({ where: { id: ctx.user.id }, select: { isDemo: true } })
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Silakan masuk terlebih dahulu.' })
    if (user.isDemo) throw new TRPCError({ code: 'FORBIDDEN', message: 'Akun demo bersifat hanya-baca dan tidak dapat didaftarkan sebagai pemilik.' })
    const profile = await ctx.prisma.ownerProfile.upsert({ where: { userId: ctx.user.id }, update: {}, create: { userId: ctx.user.id }, select: { id: true } })
    return { ownerProfileId: profile.id }
  }),

  /** What /owner/:id renders. `id` is the OwnerProfile id (the same one Kos.ownerId points at). */
  publicProfile: publicProcedure.input(idInput).query(async ({ ctx, input }): Promise<OwnerPublicProfile> => {
    const owner = await ctx.prisma.ownerProfile.findUnique({ where: { id: input.id }, include: { user: true } })
    if (!owner) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pemilik tidak ditemukan.' })
    const kos = await queryCards(ctx.prisma, { mediaBase: ctx.storage.publicUrl(''), where: Prisma.sql`k."ownerId" = ${owner.id}`, limit: 200 })
    return {
      owner: {
        id: owner.id,
        name: owner.user.name,
        avatar: owner.user.image,
        phone: owner.user.phone,
        bio: owner.bio,
        verified: owner.verified,
        responseRate: owner.responseRate,
        memberSince: owner.memberSince.toISOString(),
        totalProperties: kos.length,
      },
      kos,
    }
  }),

  /** The caller's kos with computed room status and counts (the workspace's property picker and KosManager). */
  myKos: ownerOnlyProcedure.query(async ({ ctx }): Promise<OwnerKos[]> => {
    const kos = await ctx.prisma.kos.findMany({
      where: { ownerId: ctx.ownerProfileId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { images: { orderBy: { order: 'asc' }, take: 1 }, nearestCampus: { select: { id: true, shortName: true } } },
    })
    const boards = await loadBoardRooms(ctx.prisma, kos.map((k) => k.id))
    return kos.map((k): OwnerKos => {
      const rooms = boards.get(k.id) ?? []
      const img = k.images[0]
      return {
        id: k.id,
        slug: k.slug,
        name: k.name,
        gender: k.gender,
        address: k.address,
        district: k.district,
        city: k.city,
        lat: k.lat,
        lng: k.lng,
        electricityType: k.electricityType,
        privateAmenities: k.privateAmenities,
        sharedAmenities: k.sharedAmenities,
        studentDiscountAmount: k.studentDiscountAmount,
        image: img ? (img.url ?? ctx.storage.publicUrl(img.key!)) : null,
        nearestCampus: k.nearestCampus ? { ...k.nearestCampus, meters: k.nearestCampusMeters } : null,
        totalRooms: rooms.length,
        occupiedRooms: rooms.filter((r) => r.status !== 'vacant').length,
        rooms,
      }
    })
  }),

  /** The occupancy board of one kos plus the dashboard numbers. */
  board: ownerProcedure.input(kosIdOnly).query(async ({ ctx, input }): Promise<OwnerBoard> => {
    const now = new Date()
    const rooms = (await loadBoardRooms(ctx.prisma, [input.kosId], now)).get(input.kosId) ?? []
    return { rooms, summary: await loadBoardSummary(ctx.prisma, input.kosId, rooms, now) }
  }),

  /** Every review of one kos, newest first (ReviewsManager). */
  reviews: ownerProcedure.input(kosIdOnly).query(async ({ ctx, input }): Promise<OwnerReview[]> => {
    const rows = await ctx.prisma.review.findMany({
      where: { tenancy: { room: { kosId: input.kosId } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: { tenancy: { select: { user: { select: { name: true, campus: true, image: true } } } } },
    })
    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      subRatings: { cleanliness: r.cleanliness, wifi: r.wifi, owner: r.ownerRating, quietness: r.quietness },
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      authorName: r.tenancy.user.name,
      authorCampus: r.tenancy.user.campus,
      authorAvatar: r.tenancy.user.image,
      verified: r.verifiedStudent,
      ownerReply: r.ownerReply ? { text: r.ownerReply, at: r.ownerReplyAt?.toISOString() ?? null } : null,
    }))
  }),

  /** The kos's photos in display order (the photo manager). */
  images: ownerProcedure.input(kosIdOnly).query(async ({ ctx, input }): Promise<OwnerImage[]> => {
    const rows = await ctx.prisma.kosImage.findMany({ where: { kosId: input.kosId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] })
    return rows.map((i) => ({ id: i.id, url: i.url ?? ctx.storage.publicUrl(i.key!), order: i.order, width: i.width, height: i.height }))
  }),

  image: ownerImageRouter,

  visits: ownerVisits,

  visit: ownerVisitRouter,

  waitlistEntries: ownerWaitlistEntries,

  waitlist: ownerWaitlistRouter,

  kos: router({
    /** No kosId exists yet, so this needs an OwnerProfile rather than ownerProcedure. */
    create: ownerOnlyProcedure.input(kosCreateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const { imageUrl, initialRooms, ...fields } = input
      const campus = await nearestCampus(ctx.prisma, fields.lat, fields.lng)
      const rooms = initialRooms
        ? Array.from({ length: initialRooms.count }, (_, i) => {
            const floor = Math.floor(i / 4) + 1
            return {
              roomNumber: `${floor}${String((i % 4) + 1).padStart(2, '0')}`,
              floor,
              type: 'Standar',
              size: '3 x 3 m',
              bedType: 'Single Bed',
              priceMonthly: initialRooms.priceMonthly,
            }
          })
        : []
      for (let attempt = 0; ; attempt++) {
        try {
          return await ctx.prisma.kos.create({
            data: {
              ...fields,
              ...campus,
              slug: `${slugify(fields.name)}-${randomUUID().slice(0, 6)}`,
              ownerId: ctx.ownerProfileId,
              images: imageUrl ? { create: [{ url: imageUrl, order: 0 }] } : undefined,
              rooms: rooms.length ? { create: rooms } : undefined,
            },
            select: { id: true },
          })
        } catch (e) {
          // Only a slug collision can retry; a duplicate room number cannot happen with generated numbers.
          if (!isUniqueViolation(e) || attempt >= 2) throw e
        }
      }
    }),

    update: ownerProcedure.input(kosUpdateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const { kosId, ...fields } = input
      const current = await ctx.prisma.kos.findUniqueOrThrow({ where: { id: kosId }, select: { lat: true, lng: true } })
      const moved = current.lat !== fields.lat || current.lng !== fields.lng
      const campus = moved ? await nearestCampus(ctx.prisma, fields.lat, fields.lng) : {}
      await ctx.prisma.kos.update({ where: { id: kosId }, data: { ...fields, ...campus } })
      return { id: kosId }
    }),

    /** Refused while any live tenancy exists; demo accounts never delete (spec section 5). */
    delete: ownerProcedure.input(kosIdOnly).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { isDemo: true } })
      if (user.isDemo) throw new TRPCError({ code: 'FORBIDDEN', message: 'Akun demo bersifat hanya-baca dan tidak dapat menghapus kos.' })
      const busy = await ctx.prisma.tenancy.count({ where: { room: { kosId: input.kosId }, ...live(new Date()) } })
      if (busy > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Kos ini masih memiliki sewa atau booking aktif. Akhiri sewa tersebut terlebih dahulu.' })
      if ((await ctx.prisma.waitlistEntry.count({ where: { kosId: input.kosId, ...liveOffer(new Date()) } })) > 0) throw new TRPCError({ code: 'CONFLICT', message: OFFER_ACTIVE })
      await ctx.prisma.kos.delete({ where: { id: input.kosId } })
      return { id: input.kosId }
    }),
  }),

  room: router({
    create: ownerProcedure.input(roomCreateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      try {
        // A new room may be the one a waiting student has been queueing for.
        return await ctx.prisma.$transaction(async (tx) => {
          const room = await tx.room.create({ data: input, select: { id: true } })
          await advanceWaitlist(tx, input.kosId, new Date())
          return room
        })
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: ROOM_TAKEN })
        throw e
      }
    }),

    /** The room must belong to `kosId` (already proven to be the caller's); anything else is NOT_FOUND. */
    update: ownerProcedure.input(roomUpdateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const { kosId, roomId, ...fields } = input
      let count = 0
      try {
        // A changed type can make the room match a queued preference.
        count = await ctx.prisma.$transaction(async (tx) => {
          const res = await tx.room.updateMany({ where: { id: roomId, kosId }, data: fields })
          if (res.count > 0) await advanceWaitlist(tx, kosId, new Date())
          return res.count
        })
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: ROOM_TAKEN })
        throw e
      }
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kamar tidak ditemukan.' })
      return { id: roomId }
    }),

    delete: ownerProcedure.input(roomDeleteInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const room = await ctx.prisma.room.findFirst({ where: { id: input.roomId, kosId: input.kosId }, select: { id: true } })
      if (!room) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kamar tidak ditemukan.' })
      const busy = await ctx.prisma.tenancy.count({ where: { roomId: room.id, ...live(new Date()) } })
      if (busy > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Kamar ini masih memiliki sewa atau booking aktif. Akhiri sewa tersebut terlebih dahulu.' })
      if ((await ctx.prisma.waitlistEntry.count({ where: { offeredRoomId: room.id, ...liveOffer(new Date()) } })) > 0) throw new TRPCError({ code: 'CONFLICT', message: OFFER_ACTIVE })
      await ctx.prisma.room.delete({ where: { id: room.id } })
      return { id: room.id }
    }),
  }),

  tenancy: router({
    /**
     * Move-out (ACTIVE) or cancelling a booking hold (PENDING). The room is free again, and any online payment
     * still waiting on the tenancy is marked FAILED so a late webhook cannot revive it. Paid history stays.
     */
    end: ownerProcedure.input(tenancyEndInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      return ctx.prisma.$transaction(async (tx) => {
        const t = await tx.tenancy.findFirst({ where: { id: input.tenancyId, room: { kosId: input.kosId } }, select: { id: true, roomId: true } })
        if (!t) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sewa tidak ditemukan.' })
        const ended = await tx.tenancy.updateMany({ where: { id: t.id, status: { in: ['ACTIVE', 'PENDING'] } }, data: { status: 'ENDED', endedAt: new Date() } })
        if (ended.count === 0) throw new TRPCError({ code: 'CONFLICT', message: 'Sewa ini sudah berakhir.' })
        await tx.room.update({ where: { id: t.roomId }, data: { occupancy: 'VACANT' } })
        await tx.payment.updateMany({ where: { invoice: { tenancyId: t.id }, status: 'PENDING' }, data: { status: 'FAILED' } })
        await advanceWaitlist(tx, input.kosId, new Date())
        return { id: t.id }
      })
    }),
  }),
})
