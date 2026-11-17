import { Prisma } from '../generated/prisma/client.ts'
import type { PrismaClient } from '../db/client.ts'

export interface KosCard {
  id: string
  slug: string
  name: string
  gender: 'CAMPUR' | 'PUTRA' | 'PUTRI'
  district: string
  city: string
  lat: number
  lng: number
  nearestCampusId: string | null
  nearestCampusMeters: number | null
  studentDiscountAmount: number
  electricityType: 'INCLUDED' | 'TOKEN'
  images: string[]
  /** Mean review rating rounded to 1 decimal; null when there are no reviews. */
  rating: number | null
  reviewCount: number
  /** Cheapest room price; null when the kos has no rooms. */
  priceMonthlyStart: number | null
  totalRooms: number
  /** Bookable rooms: no ACTIVE tenancy, no unexpired PENDING hold, no live waitlist offer. */
  availableRooms: number
}

// Aggregates are computed on read (spec section 3): nothing cached on Kos.
const CARD_COLUMNS = Prisma.sql`
  k.id, k.slug, k.name, k.gender::text AS gender, k.district, k.city, k.lat, k.lng,
  k."nearestCampusId", k."nearestCampusMeters", k."studentDiscountAmount",
  k."electricityType"::text AS "electricityType",
  COALESCE(img.urls, ARRAY[]::text[]) AS images,
  rev.rating,
  COALESCE(rev.count, 0)::int AS "reviewCount",
  rm."priceMonthlyStart",
  COALESCE(rm.total, 0)::int AS "totalRooms",
  COALESCE(rm.available, 0)::int AS "availableRooms"`

const cardJoins = (mediaBase: string) => Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT array_agg(COALESCE(i.url, ${mediaBase}::text || i.key) ORDER BY i."order") AS urls
    FROM "KosImage" i WHERE i."kosId" = k.id
  ) img ON true
  LEFT JOIN LATERAL (
    SELECT ROUND(AVG(r.rating), 1)::float8 AS rating, COUNT(*) AS count
    FROM "Review" r
    JOIN "Tenancy" t ON t.id = r."tenancyId"
    JOIN "Room" ro ON ro.id = t."roomId"
    WHERE ro."kosId" = k.id
  ) rev ON true
  LEFT JOIN LATERAL (
    SELECT
      MIN(ro."priceMonthly") AS "priceMonthlyStart",
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM "Tenancy" t
        WHERE t."roomId" = ro.id
          AND (t.status = 'ACTIVE' OR (t.status = 'PENDING' AND t."expiresAt" > now()))
      ) AND NOT EXISTS (
        SELECT 1 FROM "WaitlistEntry" w
        WHERE w."offeredRoomId" = ro.id
          AND w.status = 'OFFERED'
          AND w."offerExpiresAt" >= now()
      )) AS available
    FROM "Room" ro WHERE ro."kosId" = k.id AND ro."archivedAt" IS NULL
  ) rm ON true`

interface CardQuery {
  /** Extra select expressions, starting with a comma-free fragment (e.g. a distance column). */
  extraSelect?: Prisma.Sql
  where?: Prisma.Sql
  orderBy?: Prisma.Sql
  limit: number
  /** Storage.publicUrl(''): prefix that turns an uploaded photo's key into its public URL. */
  mediaBase: string
  /** The viewer's OwnerProfile id: their own kos stay visible while their account waits for approval. */
  viewerOwnerId?: string | null
}

/** The one card query behind kos.list, kos.search, kos.detail and owner.publicProfile. */
export function queryCards<T = KosCard>(prisma: PrismaClient, q: CardQuery): Promise<T[]> {
  return prisma.$queryRaw<T[]>(Prisma.sql`
    SELECT ${CARD_COLUMNS}${q.extraSelect ? Prisma.sql`, ${q.extraSelect}` : Prisma.empty}
    FROM "Kos" k
    JOIN "OwnerProfile" op ON op.id = k."ownerId" ${cardJoins(q.mediaBase)}
    WHERE k."archivedAt" IS NULL AND (op."approvedAt" IS NOT NULL OR k."ownerId" = ${q.viewerOwnerId ?? ''})
    ${q.where ? Prisma.sql`AND (${q.where})` : Prisma.empty}
    ORDER BY ${q.orderBy ? Prisma.sql`${q.orderBy}, ` : Prisma.empty}k."createdAt", k.id
    LIMIT ${q.limit}`)
}

/**
 * Haversine in SQL: the same formula as haversineMeters in @kobo/shared/domain (R = 6,371,000 m).
 * A test pins the two within 1 m (PG rounds half-to-even, JS half-up).
 */
export function haversineSql(lat: number, lng: number): Prisma.Sql {
  return Prisma.sql`ROUND(2 * 6371000 * ASIN(SQRT(LEAST(1.0,
    POWER(SIN(RADIANS(k.lat - ${lat}::float8) / 2), 2) +
    COS(RADIANS(${lat}::float8)) * COS(RADIANS(k.lat)) * POWER(SIN(RADIANS(k.lng - ${lng}::float8) / 2), 2)
  ))))::int`
}
