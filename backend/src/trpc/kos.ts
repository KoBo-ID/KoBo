import { deriveRoomStatus } from '@kobo/shared/domain'
import { idInput, kosListInput, kosSearchInput } from '@kobo/shared/schemas'
import { PRICE_MAX, SEARCH_LIMIT, SEARCH_RADIUS_METERS } from '@kobo/shared/search'
import type { RoomStatus } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import { Prisma } from '../generated/prisma/client.ts'
import { liveOffer } from '../waitlist.ts'
import { haversineSql, queryCards } from './kosQueries.ts'
import type { KosCard } from './kosQueries.ts'
import { publicProcedure, router } from './trpc.ts'

export type { KosCard } from './kosQueries.ts'

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
  nearestCampus: { id: string; shortName: string } | null
  /** Per-aspect mean (1 decimal); null when no review rated that aspect. */
  subRatings: { cleanliness: number | null; wifi: number | null; owner: number | null; quietness: number | null }
  rooms: RoomView[]
  rules: { id: string; tier: number; categoryTitle: string; rules: string[]; penaltyAmount: number | null; penaltyClause: string | null }[]
  pois: { id: string; category: string; name: string; distanceMeters: number; walkMinutes: number; description: string }[]
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
  search: publicProcedure.input(kosSearchInput).query(({ ctx, input }): Promise<KosSearchCard[]> => {
    const { q, lat, lng, gender, maxPrice, discountOnly, surveyOnly, sort } = input
    const geo = lat !== undefined && lng !== undefined
    const dist = geo ? haversineSql(lat, lng) : null
    const conds: Prisma.Sql[] = []
    if (dist) conds.push(Prisma.sql`${dist} <= ${SEARCH_RADIUS_METERS}`)
    if (gender !== 'all') conds.push(Prisma.sql`k.gender = ${gender.toUpperCase()}::"KosGender"`)
    // At PRICE_MAX the slider is "off": do not hide kos that cost more than the slider range.
    if (maxPrice < PRICE_MAX) conds.push(Prisma.sql`rm."priceMonthlyStart" <= ${maxPrice}`)
    if (discountOnly) conds.push(Prisma.sql`k."studentDiscountAmount" > 0`)
    if (surveyOnly) conds.push(Prisma.sql`COALESCE(rm.available, 0) > 0`)
    if (q) {
      // position() instead of ILIKE so %, _ and \ in the query are literal.
      const has = (col: Prisma.Sql) => Prisma.sql`position(lower(${q}::text) in lower(${col})) > 0`
      conds.push(Prisma.sql`(
        ${has(Prisma.sql`k.name`)} OR ${has(Prisma.sql`k.address`)} OR ${has(Prisma.sql`k.district`)}
        OR EXISTS (SELECT 1 FROM unnest(k."privateAmenities" || k."sharedAmenities") AS a(name) WHERE ${has(Prisma.sql`a.name`)})
      )`)
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
    const [card] = await queryCards(prisma, { mediaBase: ctx.storage.publicUrl(''), where: Prisma.sql`k.id = ${input.id}`, limit: 1 })
    if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kos tidak ditemukan.' })

    const now = new Date()
    const session = await ctx.getSession()
    const [kos, rooms, rules, pois, reviews, subs, offers] = await Promise.all([
      prisma.kos.findUniqueOrThrow({
        where: { id: card.id },
        include: { nearestCampus: { select: { id: true, shortName: true } }, owner: { include: { user: true } } },
      }),
      prisma.room.findMany({
        where: { kosId: card.id },
        include: {
          tenancies: {
            where: { status: { in: ['ACTIVE', 'PENDING'] } },
            include: { invoices: { where: { status: 'UNPAID' }, orderBy: { dueDate: 'asc' }, take: 1 } },
          },
        },
      }),
      prisma.houseRule.findMany({ where: { kosId: card.id }, orderBy: [{ tier: 'asc' }, { id: 'asc' }] }),
      prisma.poi.findMany({ where: { kosId: card.id }, orderBy: { id: 'asc' } }),
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
          reservedForWaitlist: !!offer && offer.userId !== session?.user.id,
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
