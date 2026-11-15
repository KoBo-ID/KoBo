import { haversineMeters, neighbourCells, type LatLng } from '@kobo/shared/domain'
import { DISTANCE_NOTE, MAX_PLACE_RADIUS, modeFor, minutesFor, modeLabel, OSM_ATTRIBUTION, PLACE_CATEGORIES, placeCategory, rankPlaces, type PlaceCategoryId, type RankablePlace, type TravelMode } from '@kobo/shared/places'
import { Prisma } from './generated/prisma/client.ts'
import type { PrismaClient } from './db/client.ts'
import { regionLookup } from './regionLookup.ts'

type Db = PrismaClient | Prisma.TransactionClient

export const NEAREST_CAMPUS_MAX_METERS = 10_000
const CANDIDATE_LIMIT = 80

export interface PlaceHit extends RankablePlace {
  name: string
  category: PlaceCategoryId
  subcategory: string | null
  lat: number
  lng: number
  source: string
  sourceLabel: string
}

const SOURCE_LABEL: Record<string, string> = { osm: 'OpenStreetMap', overture: 'Overture Maps', owner: 'Pemilik kos', kobo: 'KoBo' }

const ATTRIBUTION_FOR: Record<string, { text: string; href: string }> = {
  OpenStreetMap: OSM_ATTRIBUTION,
  'Overture Maps': { text: 'Overture Maps Foundation', href: 'https://overturemaps.org/' },
}

/** Distance in SQL for a table alias; the same formula as haversineSql. */
function distSql(alias: string, lat: number, lng: number): Prisma.Sql {
  const a = Prisma.raw(`"${alias}"`)
  return Prisma.sql`ROUND(2 * 6371000 * ASIN(SQRT(LEAST(1.0,
    POWER(SIN(RADIANS(${a}.lat - ${lat}::float8) / 2), 2) +
    COS(RADIANS(${lat}::float8)) * COS(RADIANS(${a}.lat)) * POWER(SIN(RADIANS(${a}.lng - ${lng}::float8) / 2), 2)
  ))))::int`
}

/** The active place datasets, one per source ("osm-java-261025+overture-2026-10-21.0"), or 'none' when nothing is loaded. */
export async function activePlacesVersion(db: Db): Promise<string> {
  const rows = await db.catalogMeta.findMany({ where: { dataset: { startsWith: 'places' }, status: 'active' }, select: { version: true } })
  const versions = rows.map((r) => r.version.slice(r.version.indexOf(':') + 1)).sort()
  return versions.length ? versions.join('+') : 'none'
}

/**
 * Raw candidates per category from PlaceCatalog: cells first (index), then exact distance. Unnamed rows and rows the
 * catalogue itself hides never come back. Campuses are not in this table (they live in Campus).
 */
export async function placeCandidates(db: Db, p: LatLng, categories: readonly PlaceCategoryId[]): Promise<PlaceHit[]> {
  const wanted = categories.filter((c) => c !== 'campus')
  const perCategory = await Promise.all(
    wanted.map(async (id) => {
      const cat = placeCategory(id)!
      const cells = neighbourCells(p.lat, p.lng, cat.moreRadius)
      const d = distSql('pc', p.lat, p.lng)
      const rows = await db.$queryRaw<
        { id: string; name: string; brand: string | null; score: number; subcategory: string | null; lat: number; lng: number; source: string; distanceM: number }[]
      >(Prisma.sql`
        SELECT * FROM (
          SELECT pc.id, pc.name, pc.brand, pc.score, pc.subcategory, pc.lat, pc.lng, pc.source, ${d} AS "distanceM"
          FROM "PlaceCatalog" pc
          WHERE pc.category = ${id} AND pc.cell IN (${Prisma.join(cells)}) AND NOT pc."isHidden" AND pc.name <> ''
        ) q WHERE q."distanceM" <= ${cat.moreRadius}
        ORDER BY q."distanceM" ASC LIMIT ${CANDIDATE_LIMIT}`)
      return rows.map((r): PlaceHit => ({ ...r, category: id, sourceLabel: SOURCE_LABEL[r.source] ?? r.source }))
    }),
  )
  return perCategory.flat()
}

export interface RankedByCategory {
  category: PlaceCategoryId
  primary: PlaceHit[]
  more: PlaceHit[]
}

/** Ranked places around a point, per category, with the caps and the chain rule of the radius table. */
export async function placesNear(db: Db, p: LatLng, categories: readonly PlaceCategoryId[] = PLACE_CATEGORIES.map((c) => c.id)): Promise<RankedByCategory[]> {
  const hits = await placeCandidates(db, p, categories)
  return categories
    .filter((c) => c !== 'campus')
    .map((c) => ({ category: c, ...rankPlaces(hits.filter((h) => h.category === c), placeCategory(c)!) }))
}

export interface CampusNear {
  id: string
  name: string
  shortName: string
  city: string
  meters: number
  /** True when the distance is to a surveyed gate rather than the campus centre. */
  toGate: boolean
}

/**
 * Up to `n` campuses nearest to the point, within `maxMeters`. The distance is to the gate when one is known (gateLat/gateLng),
 * else to the campus point. Replaces the single-campus helper: n = 1 with the default maximum gives the old behaviour.
 */
export async function nearestCampuses(db: Db, p: LatLng, n = 3, maxMeters = NEAREST_CAMPUS_MAX_METERS): Promise<CampusNear[]> {
  const dLat = maxMeters / 111_320
  const dLng = maxMeters / (111_320 * Math.max(0.01, Math.cos((p.lat * Math.PI) / 180)))
  // Gate points sit within a few hundred metres of the campus point, so a box padded by 0.01 degree is safe for both.
  const pad = 0.01
  const rows = await db.campus.findMany({
    where: { lat: { gte: p.lat - dLat - pad, lte: p.lat + dLat + pad }, lng: { gte: p.lng - dLng - pad, lte: p.lng + dLng + pad } },
    select: { id: true, name: true, shortName: true, city: true, lat: true, lng: true, gateLat: true, gateLng: true },
  })
  return rows
    .map((c) => {
      const toGate = c.gateLat !== null && c.gateLng !== null
      const meters = haversineMeters(p, toGate ? { lat: c.gateLat!, lng: c.gateLng! } : { lat: c.lat, lng: c.lng })
      return { id: c.id, name: c.name, shortName: c.shortName, city: c.city, meters, toGate }
    })
    .filter((c) => c.meters <= maxMeters)
    .sort((a, b) => a.meters - b.meters || a.id.localeCompare(b.id))
    .slice(0, n)
}

export interface AttachResult {
  catalogVersion: string
  rows: number
}

/**
 * Rebuilds the "what is near this kos" snapshot as references (KosPlace). Owner decisions survive: places the owner hid
 * (PlaceOverlay) stay in the snapshot flagged hidden, approved owner-added places are included. Call it when the kos is
 * created, when its point moves, or on an explicit refresh - never on a page view.
 */
export async function attachPlaces(tx: Prisma.TransactionClient, kosId: string): Promise<AttachResult> {
  const kos = await tx.kos.findUniqueOrThrow({ where: { id: kosId }, select: { lat: true, lng: true } })
  const point = { lat: kos.lat, lng: kos.lng }
  const [version, overlays, ownerAdded, campuses, hits] = await Promise.all([
    activePlacesVersion(tx),
    tx.placeOverlay.findMany({ where: { kosId, override: 'hide' }, select: { placeId: true } }),
    tx.ownerPlace.findMany({ where: { kosId, status: 'approved' } }),
    nearestCampuses(tx, point, 5, 5000),
    placeCandidates(tx, point, PLACE_CATEGORIES.map((c) => c.id)),
  ])
  const hidden = new Set(overlays.map((o) => o.placeId))
  const rows: Prisma.KosPlaceCreateManyInput[] = []

  const push = (h: { id: string; category: PlaceCategoryId; distanceM: number; sourceLabel: string }, rank: number, extra: { added?: boolean; hidden?: boolean } = {}) => {
    const mode: TravelMode = modeFor(h.category, h.distanceM)
    rows.push({ kosId, placeId: h.id, category: h.category, distanceM: h.distanceM, mode, rank, catalogVersion: version, hiddenByOwner: extra.hidden ?? false, addedByOwner: extra.added ?? false, sourceLabel: h.sourceLabel })
  }

  const asHit = (o: (typeof ownerAdded)[number]): PlaceHit => ({
    id: o.id, name: o.name, brand: null, score: 3, category: o.category as PlaceCategoryId, subcategory: null, lat: o.lat, lng: o.lng,
    source: 'owner', sourceLabel: SOURCE_LABEL.owner!, distanceM: haversineMeters(point, { lat: o.lat, lng: o.lng }),
  })
  const pool = [...hits, ...ownerAdded.map(asHit)]

  for (const cat of PLACE_CATEGORIES) {
    if (cat.id === 'campus') {
      campuses.forEach((c, i) => push({ id: c.id, category: 'campus', distanceM: c.meters, sourceLabel: SOURCE_LABEL.kobo! }, i, { hidden: hidden.has(c.id) }))
      continue
    }
    const inCat = pool.filter((h) => h.category === cat.id)
    const visible = inCat.filter((h) => !hidden.has(h.id))
    const ranked = rankPlaces(visible, cat)
    ;[...ranked.primary, ...ranked.more].forEach((h, i) => push(h, i, { added: h.source === 'owner' }))
    // Hidden places stay in the snapshot so the owner can unhide them.
    inCat.filter((h) => hidden.has(h.id) && h.distanceM <= cat.moreRadius).slice(0, 10).forEach((h, i) => push(h, 100 + i, { hidden: true, added: h.source === 'owner' }))
  }

  await tx.kosPlace.deleteMany({ where: { kosId } })
  if (rows.length) await tx.kosPlace.createMany({ data: rows })
  return { catalogVersion: version, rows: rows.length }
}

/** Resolves the point to a region and stamps the kos (desaCode, regionConfidence). Returns what it wrote. */
export async function stampKosRegion(db: Db, kosId: string, p: LatLng): Promise<{ desaCode: string | null; regionConfidence: string | null }> {
  const hit = await regionLookup(db as PrismaClient, p)
  const data = { desaCode: hit?.finestCode ?? null, regionConfidence: hit?.confidence ?? null }
  await db.kos.update({ where: { id: kosId }, data })
  return data
}

export interface NearbyItem {
  id: string
  name: string
  subcategory: string | null
  distanceM: number
  distanceLabel: string
  mode: TravelMode
  modeLabel: string
  minutes: number
  /** "5 mnt jalan kaki (perkiraan)" next to a number the UI must not present as a route. */
  minutesNote: string
  lat: number
  lng: number
  sourceLabel: string
  addedByOwner: boolean
}

export interface NearbyGroup {
  category: PlaceCategoryId
  label: string
  items: NearbyItem[]
  more: NearbyItem[]
}

export interface NearbyView {
  groups: NearbyGroup[]
  /** Straight-line note and the licence lines the page must show beside the list. */
  distanceNote: typeof DISTANCE_NOTE
  attribution: typeof OSM_ATTRIBUTION
  /** Every credit the shown list needs (OSM always; Overture when one of its places is shown). */
  attributions: { text: string; href: string }[]
  catalogVersion: string | null
}

const fmt = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1).replace('.', ',')} km`)

/** The public "Lokasi dan sekitar kos" list, built from the snapshot. Hidden places and pending owner places never appear. */
export async function loadNearby(db: Db, kosId: string): Promise<NearbyView | null> {
  const snap = await db.kosPlace.findMany({ where: { kosId, hiddenByOwner: false }, orderBy: [{ category: 'asc' }, { rank: 'asc' }] })
  if (snap.length === 0) return null
  const ids = snap.map((s) => s.placeId)
  const [catalog, owners, campuses] = await Promise.all([
    db.placeCatalog.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, subcategory: true, lat: true, lng: true } }),
    db.ownerPlace.findMany({ where: { id: { in: ids }, status: 'approved' }, select: { id: true, name: true, lat: true, lng: true } }),
    db.campus.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, lat: true, lng: true } }),
  ])
  const byId = new Map<string, { name: string; subcategory: string | null; lat: number; lng: number }>()
  for (const c of catalog) byId.set(c.id, c)
  for (const o of owners) byId.set(o.id, { ...o, subcategory: null })
  for (const c of campuses) byId.set(c.id, { name: c.name, subcategory: 'kampus', lat: c.lat, lng: c.lng })

  const groups: NearbyGroup[] = []
  for (const cat of PLACE_CATEGORIES) {
    const items: NearbyItem[] = []
    for (const s of snap.filter((x) => x.category === cat.id)) {
      const ref = byId.get(s.placeId)
      if (!ref) continue // the catalogue row was removed by a newer version: the snapshot entry is skipped, not invented
      const mode = s.mode as TravelMode
      const minutes = minutesFor(mode, s.distanceM)
      items.push({
        id: s.placeId, name: ref.name, subcategory: ref.subcategory, distanceM: s.distanceM, distanceLabel: `${fmt(s.distanceM)} ${DISTANCE_NOTE}`, mode, modeLabel: modeLabel(mode), minutes,
        minutesNote: `${minutes} mnt ${modeLabel(mode)} (perkiraan)`, lat: ref.lat, lng: ref.lng, sourceLabel: s.sourceLabel, addedByOwner: s.addedByOwner,
      })
    }
    if (items.length === 0) continue
    const primary = items.filter((i) => i.distanceM <= cat.primaryRadius).slice(0, cat.cap)
    groups.push({ category: cat.id, label: cat.label, items: primary, more: items.filter((i) => !primary.includes(i)) })
  }
  const labels = new Set(groups.flatMap((g) => [...g.items, ...g.more].map((i) => i.sourceLabel)))
  const attributions = [OSM_ATTRIBUTION as { text: string; href: string }, ...[...labels].filter((l) => l !== 'OpenStreetMap').flatMap((l) => (ATTRIBUTION_FOR[l] ? [ATTRIBUTION_FOR[l]!] : []))]
  return { groups, distanceNote: DISTANCE_NOTE, attribution: OSM_ATTRIBUTION, attributions, catalogVersion: snap[0]!.catalogVersion }
}
