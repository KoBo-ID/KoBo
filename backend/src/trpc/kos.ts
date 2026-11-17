import { itemsFromArrays } from '@kobo/shared/facilities'
import type { FacilityItem } from '@kobo/shared/facilities'
import { deriveRoomStatus, pointInMultiPolygon } from '@kobo/shared/domain'
import type { MultiPolygonCoords } from '@kobo/shared/domain'
import { idInput, kosListInput, kosSearchInput } from '@kobo/shared/schemas'
import { PRICE_MAX, SEARCH_LIMIT, SEARCH_RADIUS_METERS } from '@kobo/shared/search'
import type { RoomStatus } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '../db/client.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { liveOffer, roomClaims } from '../waitlist.ts'
import { loadNearby } from '../placeCatalog.ts'
import type { NearbyView } from '../placeCatalog.ts'
import { haversineSql, queryCards } from './kosQueries.ts'
import type { KosCard } from './kosQueries.ts'
import { publicProcedure, router } from './trpc.ts'

export type { KosCard } from './kosQueries.ts'


/** Ids of kos with no desaCode whose point lies in the region (polygon test; bbox only when no polygon is stored). Levels 1 to 3. */
async function unmappedKosInRegion(prisma: PrismaClient, regionCode: string): Promise<string[]> {
  if (regionCode.split('.').length > 3) return []
  const r = await prisma.region.findUnique({ where: { code: regionCode }, select: { minLat: true, maxLat: true, minLng: true, maxLng: true, polygon: true } })
  if (!r || r.minLat === null || r.maxLat === null || r.minLng === null || r.maxLng === null) return []
  const bbox = { minLat: r.minLat, maxLat: r.maxLat, minLng: r.minLng, maxLng: r.maxLng }
  const rows = await prisma.$queryRaw<{ id: string; lat: number; lng: number }[]>(Prisma.sql`
    SELECT id, lat, lng FROM "Kos"
    WHERE "desaCode" IS NULL AND lat BETWEEN ${bbox.minLat} AND ${bbox.maxLat} AND lng BETWEEN ${bbox.minLng} AND ${bbox.maxLng}`)
  const polygon = (r.polygon as { coordinates?: MultiPolygonCoords } | null)?.coordinates ?? null
  return rows.filter((k) => !polygon || pointInMultiPolygon({ lat: k.lat, lng: k.lng }, polygon, bbox)).map((k) => k.id)
}

export interface KosSearchCard extends KosCard {
  /** Metres from the search reference point; null when the search has none. */
  distanceMeters: number | null
}

export interface RoomView {
  id: string
  roomNumber: string
  floor: number
  type: string
  size: string
  bedType: string
  priceMonthly: number
  /** Derived (never stored): vacant / booking / paid / due / overdue. No tenant data is exposed. */
  status: RoomStatus
  /** A live daftar tunggu offer is held for someone else: not selectable even though the room reads vacant. */
  reservedForWaitlist: boolean
  /** The live offer on this room is the signed-in student's. */
  offeredToMe: boolean
}

export interface ReviewView {
  id: string
  rating: number
  comment: string
  createdAt: string
  authorName: string
  authorCampus: string | null
  authorAvatar: string | null
  /** Snapshot of the author's campus-email verification when the review was written. */
  verified: boolean
  ownerReply: { text: string; at: string | null } | null
}

export interface OwnerPublic {
  id: string
  name: string
  avatar: string | null
  phone: string | null
  bio: string | null
  verified: boolean
  responseRate: string | null
  /** ISO timestamp; the client formats it ("Maret 2024"). */
  memberSince: string
  totalProperties: number
}

export interface KosDetail extends KosCard {
  address: string
  applicationFee: number
  privateAmenities: string[]
  sharedAmenities: string[]
  /** Structured facilities; rows saved before they existed are derived from the flat arrays. */
  facilities: FacilityItem[]
  building: { floors: number | null; yearBuilt: number | null; areaM2: number | null; roomCount: number }
  nearestCampus: { id: string; shortName: string } | null
  /** Per-aspect mean (1 decimal); null when no review rated that aspect. */
  subRatings: { cleanliness: number | null; wifi: number | null; owner: number | null; quietness: number | null }
  rooms: RoomView[]
  rules: { id: string; tier: number; categoryTitle: string; rules: string[]; penaltyAmount: number | null; penaltyClause: string | null }[]
  pois: { id: string; category: string; name: string; distanceMeters: number; walkMinutes: number; description: string }[]
  /** The catalogue-based "Lokasi dan sekitar kos" list (grouped, with the licence lines to show). Null until a snapshot exists; the UI then falls back to `pois`. */
  nearby: NearbyView | null
  owner: OwnerPublic
  /** Newest first, capped at REVIEW_LIMIT; `reviewCount` is the total. */
  reviews: ReviewView[]
}

const REVIEW_LIMIT = 50

const round1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10)
const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export const kosRouter = router({
  list: publicProcedure.input(kosListInput).query(({ ctx, input }): Promise<KosCard[]> => {
    return queryCards(ctx.prisma, { mediaBase: ctx.storage.publicUrl(''), limit: input?.limit ?? SEARCH_LIMIT })
  }),

  /**
   * One query: card fields + aggregates + distance, filtered and sorted in SQL, hard-capped at 200.
   * No pagination and no bbox (spec section 10): the list and the map render the same array.
   */
  search: publicProcedure.input(kosSearchInput).query(async ({ ctx, input }): Promise<KosSearchCard[]> => {
    const { q, lat, lng, radius, regionCode, gender, maxPrice, discountOnly, surveyOnly, sort } = input
    const geo = lat !== undefined && lng !== undefined
    const dist = geo ? haversineSql(lat, lng) : null
    const conds: Prisma.Sql[] = []
    if (dist) conds.push(Prisma.sql`${dist} <= ${radius ?? SEARCH_RADIUS_METERS}`)
    if (regionCode) {
      // Kos with a stored desaCode match by prefix. Kos without one (older rows, imports before the catalogue) are placed
      // by their point against the region polygon (bbox only when the region has no polygon), never by a radius.
      const unmapped = await unmappedKosInRegion(ctx.prisma, regionCode)
      conds.push(
        unmapped.length
          ? Prisma.sql`(k."desaCode" = ${regionCode} OR k."desaCode" LIKE ${`${regionCode}.%`} OR k.id = ANY(${unmapped}::text[]))`
          : Prisma.sql`(k."desaCode" = ${regionCode} OR k."desaCode" LIKE ${`${regionCode}.%`})`,
      )
    }
    if (gender !== 'all') conds.push(Prisma.sql`k.gender = ${gender.toUpperCase()}::"KosGender"`)
    // At PRICE_MAX the slider is "off": do not hide kos that cost more than the slider range.
    if (maxPrice < PRICE_MAX) conds.push(Prisma.sql`rm."priceMonthlyStart" <= ${maxPrice}`)
    if (discountOnly) conds.push(Prisma.sql`k."studentDiscountAmount" > 0`)
    if (surveyOnly) conds.push(Prisma.sql`COALESCE(rm.available, 0) > 0`)
    if (q) {
      // The search box is location-only: the text matches where a kos is (address, district, city), never its name
      // or amenities. position() instead of ILIKE so %, _ and \ in the query are literal.
      const has = (col: Prisma.Sql) => Prisma.sql`position(lower(${q}::text) in lower(${col})) > 0`
      conds.push(Prisma.sql`(${has(Prisma.sql`k.address`)} OR ${has(Prisma.sql`k.district`)} OR ${has(Prisma.sql`k.city`)})`)
    }
    const orderBy =
      sort === 'price_asc'
        ? Prisma.sql`rm."priceMonthlyStart" ASC NULLS LAST`
        : sort === 'distance_asc'
          ? Prisma.sql`${dist ?? Prisma.sql`k."nearestCampusMeters"`} ASC NULLS LAST`
          : Prisma.sql`rev.rating DESC NULLS LAST`
    return queryCards<KosSearchCard>(ctx.prisma, {
      mediaBase: ctx.storage.publicUrl(''),
      extraSelect: dist ? Prisma.sql`${dist} AS "distanceMeters"` : Prisma.sql`NULL::int AS "distanceMeters"`,
      where: conds.length ? Prisma.join(conds, ' AND ') : undefined,
      orderBy,
      limit: SEARCH_LIMIT,
    })
  }),

  /** Everything the Detail page renders, in one round trip. */
  detail: publicProcedure.input(idInput).query(async ({ ctx, input }): Promise<KosDetail> => {
    const { prisma } = ctx
    const session = await ctx.getSession()
    // A kos whose owner still waits for approval is visible to that owner only.
    const viewerOwnerId = session ? ((await prisma.ownerProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } }))?.id ?? null) : null
    const [card] = await queryCards(prisma, { mediaBase: ctx.storage.publicUrl(''), where: Prisma.sql`k.id = ${input.id}`, limit: 1, viewerOwnerId })
    if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kos tidak ditemukan.' })

    const now = new Date()
    const [kos, rooms, rules, pois, nearby, reviews, subs, offers] = await Promise.all([
      prisma.kos.findUniqueOrThrow({
        where: { id: card.id },
        include: { nearestCampus: { select: { id: true, shortName: true } }, owner: { include: { user: true } } },
      }),
      prisma.room.findMany({
        where: { kosId: card.id, archivedAt: null },
        include: {
          tenancies: {
            where: { status: { in: ['ACTIVE', 'PENDING'] } },
            include: { invoices: { where: { status: 'UNPAID' }, orderBy: { dueDate: 'asc' }, take: 1 } },
          },
        },
      }),
      prisma.houseRule.findMany({ where: { kosId: card.id }, orderBy: [{ tier: 'asc' }, { id: 'asc' }] }),
      prisma.poi.findMany({ where: { kosId: card.id }, orderBy: { id: 'asc' } }),
      loadNearby(prisma, card.id),
      prisma.review.findMany({
        where: { tenancy: { room: { kosId: card.id } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: REVIEW_LIMIT,
        include: { tenancy: { select: { status: true, user: { select: { name: true, campus: true, image: true } } } } },
      }),
      prisma.review.aggregate({
        where: { tenancy: { room: { kosId: card.id } } },
        _avg: { cleanliness: true, wifi: true, ownerRating: true, quietness: true },
      }),
      prisma.waitlistEntry.findMany({ where: { kosId: card.id, ...liveOffer(now) }, select: { offeredRoomId: true, userId: true } }),
    ])

    const ownerKosCount = await prisma.kos.count({ where: { ownerId: kos.ownerId } })
    const claims = await roomClaims(prisma, card.id, now)

    const roomViews: RoomView[] = rooms
      .map((r) => {
        // An ACTIVE tenancy outranks a PENDING hold; among holds the latest expiry wins.
        const tenancy =
          r.tenancies.find((t) => t.status === 'ACTIVE') ??
          [...r.tenancies].sort((a, b) => (b.expiresAt?.getTime() ?? 0) - (a.expiresAt?.getTime() ?? 0))[0] ??
          null
        const unpaid = tenancy?.invoices[0]
        const offer = offers.find((o) => o.offeredRoomId === r.id)
        return {
          id: r.id,
          roomNumber: r.roomNumber,
          floor: r.floor,
          type: r.type,
          size: r.size,
          bedType: r.bedType,
          priceMonthly: r.priceMonthly,
          status: deriveRoomStatus({
            occupancy: r.occupancy,
            tenancy: tenancy ? { status: tenancy.status, expiresAt: tenancy.expiresAt?.toISOString() ?? null } : null,
            oldestUnpaidInvoice: unpaid ? { dueDate: dateOnly(unpaid.dueDate) } : null,
            now,
          }),
          // Held for someone else: a live offer, or the queue's next match for it (booking would offer it to them first).
          reservedForWaitlist: !!claims.get(r.id) && claims.get(r.id) !== session?.user.id,
          offeredToMe: !!offer && offer.userId === session?.user.id,
        }
      })
      .sort((a, b) => {
        const ka = `${String(a.floor).padStart(3, '0')}|${a.roomNumber}`
        const kb = `${String(b.floor).padStart(3, '0')}|${b.roomNumber}`
        return ka < kb ? -1 : ka > kb ? 1 : 0
      })

    return {
      ...card,
      address: kos.address,
      applicationFee: kos.applicationFee,
      privateAmenities: kos.privateAmenities,
      sharedAmenities: kos.sharedAmenities,
      facilities: (kos.facilities as FacilityItem[] | null) ?? itemsFromArrays(kos.privateAmenities, kos.sharedAmenities),
      building: { floors: kos.floors, yearBuilt: kos.yearBuilt, areaM2: kos.buildingAreaM2, roomCount: rooms.length },
      nearestCampus: kos.nearestCampus,
      subRatings: {
        cleanliness: round1(subs._avg.cleanliness),
        wifi: round1(subs._avg.wifi),
        owner: round1(subs._avg.ownerRating),
        quietness: round1(subs._avg.quietness),
      },
      rooms: roomViews,
      rules: rules.map((r) => ({
        id: r.id,
        tier: r.tier,
        categoryTitle: r.categoryTitle,
        rules: r.rules,
        penaltyAmount: r.penaltyAmount,
        penaltyClause: r.penaltyClause,
      })),
      pois: pois.map((p) => ({
        id: p.id,
        category: p.category,
        name: p.name,
        distanceMeters: p.distanceMeters,
        walkMinutes: p.walkMinutes,
        description: p.description,
      })),
      nearby,
      owner: {
        id: kos.owner.id,
        name: kos.owner.user.name,
        avatar: kos.owner.user.image,
        phone: kos.owner.user.phone,
        bio: kos.owner.bio,
        verified: kos.owner.verified,
        responseRate: kos.owner.responseRate,
        memberSince: kos.owner.memberSince.toISOString(),
        totalProperties: ownerKosCount,
      },
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        authorName: r.tenancy.user.name,
        authorCampus: r.tenancy.user.campus,
        authorAvatar: r.tenancy.user.image,
        verified: r.verifiedStudent,
        ownerReply: r.ownerReply ? { text: r.ownerReply, at: r.ownerReplyAt?.toISOString() ?? null } : null,
      })),
    }
  }),
})
