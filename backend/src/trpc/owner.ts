import { randomUUID } from 'node:crypto'
import { amenityArrays, itemsFromArrays } from '@kobo/shared/facilities'
import type { FacilityItem } from '@kobo/shared/facilities'
import { idInput, kosCreateInput, ownerRegisterInput, kosIdOnly, kosUpdateInput, roomCreateInput, roomDeleteInput, roomUpdateInput, rulesSetInput, tenancyEndInput, MAX_KOS_PER_OWNER, MAX_ROOMS_PER_KOS } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '../db/client.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { isAutoApproved } from '../ownerApproval.ts'
import { DAY, HOUR, limiterFor } from '../rateLimit.ts'
import { attachPlaces, NEAREST_CAMPUS_MAX_METERS, nearestCampuses, stampKosRegion } from '../placeCatalog.ts'
import { loadBoardRooms, loadBoardSummary } from '../ownerBoard.ts'
import type { BoardRoom, BoardSummary } from '../ownerBoard.ts'
import type { KosCard, OwnerPublic } from './kos.ts'
import { queryCards } from './kosQueries.ts'
import { ownerImageRouter } from './ownerImages.ts'
import { ownerPlacesRouter } from './ownerPlaces.ts'
import { ownerTenantRouter } from './ownerTenant.ts'
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
export { NEAREST_CAMPUS_MAX_METERS }

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
  floors: number | null
  yearBuilt: number | null
  buildingAreaM2: number | null
  /** Structured facilities; rows saved before they existed are read from the flat arrays. */
  facilities: FacilityItem[]
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
  const [best] = await nearestCampuses(prisma, { lat, lng }, 1, NEAREST_CAMPUS_MAX_METERS)
  return best ? { nearestCampusId: best.id, nearestCampusMeters: best.meters } : { nearestCampusId: null, nearestCampusMeters: null }
}

/**
 * After a kos is created or its pin moves: resolve its region and rebuild the "sekitar kos" snapshot. Best effort: the
 * catalogue is reference data that may be empty or mid-import, and a failure here must never block the owner's save.
 */
async function locate(prisma: PrismaClient, kosId: string, lat: number, lng: number): Promise<void> {
  try {
    await stampKosRegion(prisma, kosId, { lat, lng })
    await prisma.$transaction((tx) => attachPlaces(tx, kosId))
  } catch (e) {
    console.error(`[catalog] locate failed for kos ${kosId}:`, e instanceof Error ? e.message : e)
  }
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
  becomeOwner: authedProcedure.input(ownerRegisterInput).mutation(async ({ ctx, input }): Promise<{ ownerProfileId: string; approved: boolean }> => {
    const user = await ctx.prisma.user.findUnique({ where: { id: ctx.user.id }, select: { isDemo: true, emailVerified: true, email: true, ownerProfile: { select: { id: true, approvedAt: true } } } })
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Silakan masuk terlebih dahulu.' })
    if (user.isDemo) throw new TRPCError({ code: 'FORBIDDEN', message: 'Akun ini bersifat hanya-baca dan tidak dapat didaftarkan sebagai pemilik.' })
    // Already an owner: idempotent, nothing is rewritten.
    if (user.ownerProfile) return { ownerProfileId: user.ownerProfile.id, approved: user.ownerProfile.approvedAt !== null }
    if (!user.emailVerified) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Verifikasi email Anda terlebih dahulu sebelum mendaftar sebagai pemilik.' })
    limiterFor(ctx).check(`become-owner:${ctx.user.id}`, 3, HOUR, 'Terlalu banyak percobaan mendaftar sebagai pemilik. Coba lagi dalam satu jam.')
    const approved = isAutoApproved(user.email)
    const profile = await ctx.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: ctx.user.id }, data: { phone: input.phone } })
      const declared = input.ownershipType ? { ownershipType: input.ownershipType, ownershipDeclaredAt: new Date() } : {}
      return tx.ownerProfile.upsert({ where: { userId: ctx.user.id }, update: {}, create: { userId: ctx.user.id, ...declared, ...(approved ? { approvedAt: new Date() } : {}) }, select: { id: true } })
    })
    return { ownerProfileId: profile.id, approved }
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
      where: { ownerId: ctx.ownerProfileId, archivedAt: null },
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
        floors: k.floors,
        yearBuilt: k.yearBuilt,
        buildingAreaM2: k.buildingAreaM2,
        facilities: (k.facilities as FacilityItem[] | null) ?? itemsFromArrays(k.privateAmenities, k.sharedAmenities),
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

  places: ownerPlacesRouter,

  tenant: ownerTenantRouter,

  kos: router({
    /** No kosId exists yet, so this needs an OwnerProfile rather than ownerProcedure. */
    create: ownerOnlyProcedure.input(kosCreateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const { imageUrl, initialRooms, facilities, ...rest } = input
      // Demo accounts are reset nightly (demoReset), so the per-owner caps and the daily limit do not apply to them.
      if (!ctx.isDemo) {
        limiterFor(ctx).check(`kos-create:${ctx.user.id}`, 5, DAY, 'Terlalu banyak kos didaftarkan hari ini. Coba lagi besok.')
      }
      const fields = { ...rest, ...(facilities ? { facilities, ...amenityArrays(facilities) } : {}) }
      const campus = await nearestCampus(ctx.prisma, fields.lat, fields.lng)
      // Rooms are spread over the declared floors; without a floor count the old rule (4 per floor) applies.
      const perFloor = initialRooms ? (rest.floors ? Math.ceil(initialRooms.count / rest.floors) : 4) : 4
      const rooms = initialRooms
        ? Array.from({ length: initialRooms.count }, (_, i) => {
            const floor = Math.floor(i / perFloor) + 1
            return {
              roomNumber: `${floor}${String((i % perFloor) + 1).padStart(2, '0')}`,
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
          // One transaction per attempt (a unique violation aborts it). The OwnerProfile row lock queues parallel creates of
          // one owner, so the count below cannot go stale before the insert. FOR NO KEY UPDATE: it does not block the
          // FOR KEY SHARE that inserting a Kos (FK to OwnerProfile) takes in other transactions. It is the first lock of
          // this transaction; nothing else takes it, so it cannot deadlock with the Kos, Invoice or Tenancy locks.
          const created = await ctx.prisma.$transaction(async (tx) => {
            if (!ctx.isDemo) {
              await tx.$queryRaw`SELECT id FROM "OwnerProfile" WHERE id = ${ctx.ownerProfileId} FOR NO KEY UPDATE`
              if ((await tx.kos.count({ where: { ownerId: ctx.ownerProfileId, archivedAt: null } })) >= MAX_KOS_PER_OWNER) {
                throw new TRPCError({ code: 'CONFLICT', message: `Satu akun dapat mendaftarkan maksimal ${MAX_KOS_PER_OWNER} kos. Hubungi KoBo bila Anda mengelola lebih banyak.` })
              }
            }
            return tx.kos.create({
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
          }, { maxWait: 10_000, timeout: 20_000 })
          await locate(ctx.prisma, created.id, fields.lat, fields.lng)
          return created
        } catch (e) {
          // Only a slug collision can retry; a duplicate room number cannot happen with generated numbers.
          if (!isUniqueViolation(e) || attempt >= 2) throw e
        }
      }
    }),

    update: ownerProcedure.input(kosUpdateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const { kosId, facilities, ...rest } = input
      const fields = { ...rest, ...(facilities ? { facilities, ...amenityArrays(facilities) } : {}) }
      const current = await ctx.prisma.kos.findUniqueOrThrow({ where: { id: kosId }, select: { lat: true, lng: true } })
      const moved = current.lat !== fields.lat || current.lng !== fields.lng
      const campus = moved ? await nearestCampus(ctx.prisma, fields.lat, fields.lng) : {}
      await ctx.prisma.kos.update({ where: { id: kosId }, data: { ...fields, ...campus } })
      // A moved pin re-runs region, campus and the places snapshot (owner hides and additions are kept by placeId).
      if (moved) await locate(ctx.prisma, kosId, fields.lat, fields.lng)
      return { id: kosId }
    }),

    /**
     * Refused while anything is live; demo accounts never delete (spec section 5). A kos that ever had a tenancy is
     * ARCHIVED (hidden from the marketplace, receipts and history kept) instead of deleted; a kos with no tenancy at all is
     * deleted. The Kos row lock serialises this with approvals, applications and waitlist offers, which take it through
     * advanceWaitlist, and the Tenancy -> Room foreign key is RESTRICT, so a racing delete fails instead of cascading.
     */
    delete: ownerProcedure.input(kosIdOnly).mutation(async ({ ctx, input }): Promise<{ id: string; archived: boolean }> => {
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { isDemo: true } })
      if (user.isDemo) throw new TRPCError({ code: 'FORBIDDEN', message: 'Akun ini bersifat hanya-baca dan tidak dapat menghapus kos.' })
      return ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Kos" WHERE id = ${input.kosId} FOR UPDATE`
        const now = new Date()
        const busy = await tx.tenancy.count({ where: { room: { kosId: input.kosId }, ...live(now) } })
        if (busy > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Kos ini masih memiliki sewa atau booking aktif. Akhiri sewa tersebut terlebih dahulu.' })
        if ((await tx.rentalApplication.count({ where: { room: { kosId: input.kosId }, status: 'PENDING' } })) > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Kos ini masih memiliki pengajuan sewa yang perlu diputuskan.' })
        if ((await tx.waitlistEntry.count({ where: { kosId: input.kosId, ...liveOffer(now) } })) > 0) throw new TRPCError({ code: 'CONFLICT', message: OFFER_ACTIVE })
        if ((await tx.tenancy.count({ where: { room: { kosId: input.kosId } } })) > 0) {
          await tx.kos.update({ where: { id: input.kosId }, data: { archivedAt: now } })
          return { id: input.kosId, archived: true }
        }
        await tx.kos.delete({ where: { id: input.kosId } })
        return { id: input.kosId, archived: false }
      })
    }),
  }),

  room: router({
    create: ownerProcedure.input(roomCreateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      if (!(await ctx.prisma.user.findUnique({ where: { id: ctx.user.id }, select: { isDemo: true } }))?.isDemo) limiterFor(ctx).check(`room-create:${ctx.user.id}`, 60, HOUR, 'Terlalu banyak kamar ditambahkan. Coba lagi dalam satu jam.')
      try {
        // The Kos row lock comes first and is FOR UPDATE, the strength advanceWaitlist (ADR 0014) takes, so there is no
        // lock upgrade inside the transaction. It queues parallel creates for one kos, so the count cannot go stale.
        // A new room may be the one a waiting student has been queueing for.
        return await ctx.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Kos" WHERE id = ${input.kosId} FOR UPDATE`
          if ((await tx.room.count({ where: { kosId: input.kosId, archivedAt: null } })) >= MAX_ROOMS_PER_KOS) {
            throw new TRPCError({ code: 'CONFLICT', message: `Satu kos dapat memiliki maksimal ${MAX_ROOMS_PER_KOS} kamar.` })
          }
          const room = await tx.room.create({ data: input, select: { id: true } })
          await advanceWaitlist(tx, input.kosId, new Date())
          return room
        }, { maxWait: 10_000, timeout: 20_000 })
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

    /** Same rule as kos.delete: a room with tenancy history is archived (hidden, history kept), an unused room is deleted. */
    delete: ownerProcedure.input(roomDeleteInput).mutation(async ({ ctx, input }): Promise<{ id: string; archived: boolean }> => {
      return ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Kos" WHERE id = ${input.kosId} FOR UPDATE`
        const room = await tx.room.findFirst({ where: { id: input.roomId, kosId: input.kosId, archivedAt: null }, select: { id: true } })
        if (!room) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kamar tidak ditemukan.' })
        const now = new Date()
        const busy = await tx.tenancy.count({ where: { roomId: room.id, ...live(now) } })
        if (busy > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Kamar ini masih memiliki sewa atau booking aktif. Akhiri sewa tersebut terlebih dahulu.' })
        if ((await tx.rentalApplication.count({ where: { roomId: room.id, status: 'PENDING' } })) > 0) throw new TRPCError({ code: 'CONFLICT', message: 'Kamar ini masih memiliki pengajuan sewa yang perlu diputuskan.' })
        if ((await tx.waitlistEntry.count({ where: { offeredRoomId: room.id, ...liveOffer(now) } })) > 0) throw new TRPCError({ code: 'CONFLICT', message: OFFER_ACTIVE })
        if ((await tx.tenancy.count({ where: { roomId: room.id } })) > 0) {
          await tx.room.update({ where: { id: room.id }, data: { archivedAt: now } })
          return { id: room.id, archived: true }
        }
        await tx.room.delete({ where: { id: room.id } })
        return { id: room.id, archived: false }
      })
    }),
  }),

  rules: router({
    /** Replaces the kos' house rules. Ids are cuids, so `tier` carries the order shown on the public page. */
    set: ownerProcedure.input(rulesSetInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const { kosId, groups } = input
      await ctx.prisma.$transaction([
        ctx.prisma.houseRule.deleteMany({ where: { kosId } }),
        ctx.prisma.houseRule.createMany({
          data: groups.map((g, i) => ({
            kosId,
            tier: i + 1,
            categoryTitle: g.categoryTitle,
            rules: g.rules,
            penaltyAmount: g.penaltyAmount ?? null,
            penaltyClause: g.penaltyClause || null,
          })),
        }),
      ])
      return { id: kosId }
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
        // Same lock order as settlement and recordManual: Invoices, then their attempts, then the Tenancy.
        await tx.$queryRaw`SELECT id FROM "Invoice" WHERE "tenancyId" = ${t.id} ORDER BY id FOR UPDATE`
        await tx.payment.updateMany({
          where: { invoice: { tenancyId: t.id }, provider: { in: ['MOCK', 'XENDIT'] }, status: { in: ['CREATING', 'PENDING'] } },
          data: { status: 'FAILED', failureCode: 'TENANCY_ENDED' },
        })
        await tx.$queryRaw`SELECT id FROM "Tenancy" WHERE id = ${t.id} FOR UPDATE`
        const ended = await tx.tenancy.updateMany({ where: { id: t.id, status: { in: ['ACTIVE', 'PENDING'] } }, data: { status: 'ENDED', endedAt: new Date() } })
        if (ended.count === 0) throw new TRPCError({ code: 'CONFLICT', message: 'Sewa ini sudah berakhir.' })
        await tx.room.update({ where: { id: t.roomId }, data: { occupancy: 'VACANT' } })
        await advanceWaitlist(tx, input.kosId, new Date())
        return { id: t.id }
      })
    }),
  }),
})
