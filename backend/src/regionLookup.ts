import { haversineMeters, pointInMultiPolygon, type LatLng, type MultiPolygonCoords } from '@kobo/shared/domain'
import type { PrismaClient } from './db/client.ts'

export type RegionConfidence = 'polygon' | 'sea_fallback' | 'nearest'

export interface RegionRef {
  code: string
  name: string
  kind: string
}

export interface RegionHit {
  provinsi: RegionRef | null
  kabKota: RegionRef | null
  kecamatan: RegionRef
  /** Nearest desa/kelurahan centroid inside the kecamatan (no desa polygons are stored); null when the kecamatan has none. */
  desa: RegionRef | null
  /** The finest code known: the desa when there is one, else the kecamatan. This is what Kos.desaCode stores. */
  finestCode: string
  /** polygon: the point is inside the kecamatan polygon. sea_fallback: within SEA_FALLBACK_METERS of one (coast, islands). nearest: only the nearest centroid, low confidence. */
  confidence: RegionConfidence
}

/** Within this distance of a polygon edge a point just off the coast still belongs to that kecamatan. */
export const SEA_FALLBACK_METERS = 500
/** Farther than this from every kecamatan centroid there is no honest answer. */
const NEAREST_MAX_METERS = 15_000
/** Polygons parse lazily and live in a small LRU: the api container has 384 MB, the full polygon set is far larger. */
const POLYGON_CACHE = 300
const RESULT_CACHE = 500

class Lru<V> {
  private readonly map = new Map<string, V>()
  private readonly max: number
  constructor(max: number) {
    this.max = max
  }
  get(k: string): V | undefined {
    const v = this.map.get(k)
    if (v !== undefined) {
      this.map.delete(k)
      this.map.set(k, v)
    }
    return v
  }
  set(k: string, v: V): void {
    this.map.delete(k)
    this.map.set(k, v)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
  }
  clear(): void {
    this.map.clear()
  }
}

const polygons = new Lru<MultiPolygonCoords>(POLYGON_CACHE)
const results = new Lru<RegionHit | null>(RESULT_CACHE)

/** Tests that reload the reference tables call this. */
export function clearRegionCache(): void {
  polygons.clear()
  results.clear()
}

interface Candidate {
  code: string
  name: string
  kind: string
  lat: number
  lng: number
  minLat: number | null
  maxLat: number | null
  minLng: number | null
  maxLng: number | null
  polygon: unknown
}

function polygonOf(c: Candidate): MultiPolygonCoords | null {
  const hit = polygons.get(c.code)
  if (hit) return hit
  const geo = c.polygon as { type?: string; coordinates?: MultiPolygonCoords } | null
  if (!geo?.coordinates) return null
  polygons.set(c.code, geo.coordinates)
  return geo.coordinates
}

/** Metres from the point to the nearest polygon edge (local flat projection: exact enough over a few hundred metres). */
function nearEdgeMeters(p: LatLng, multi: MultiPolygonCoords): number {
  const mLat = 111_320
  const mLng = 111_320 * Math.cos((p.lat * Math.PI) / 180)
  let best = Infinity
  for (const poly of multi) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]!
        const [x2, y2] = ring[(i + 1) % ring.length]!
        const ax = (x1 - p.lng) * mLng
        const ay = (y1 - p.lat) * mLat
        const bx = (x2 - p.lng) * mLng
        const by = (y2 - p.lat) * mLat
        const dx = bx - ax
        const dy = by - ay
        const len2 = dx * dx + dy * dy
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2))
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
      }
    }
  }
  return best
}

const parentsOf = (code: string) => {
  const parts = code.split('.')
  return [parts[0]!, parts.slice(0, 2).join('.')]
}

async function describe(prisma: PrismaClient, kec: Candidate, p: LatLng, confidence: RegionConfidence): Promise<RegionHit> {
  const [provCode, kabCode] = parentsOf(kec.code)
  const [ancestors, desas] = await Promise.all([
    prisma.region.findMany({ where: { code: { in: [provCode, kabCode] } }, select: { code: true, name: true, kind: true } }),
    prisma.region.findMany({ where: { level: 4, parentCode: kec.code }, select: { code: true, name: true, kind: true, lat: true, lng: true } }),
  ])
  let desa: RegionRef | null = null
  let bestD = Infinity
  for (const d of desas) {
    const dist = haversineMeters(p, { lat: d.lat, lng: d.lng })
    if (dist < bestD) {
      bestD = dist
      desa = { code: d.code, name: d.name, kind: d.kind }
    }
  }
  const ref = (code: string) => ancestors.find((a) => a.code === code) ?? null
  return {
    provinsi: ref(provCode),
    kabKota: ref(kabCode),
    kecamatan: { code: kec.code, name: kec.name, kind: kec.kind },
    desa,
    finestCode: desa?.code ?? kec.code,
    confidence,
  }
}

/**
 * Which kecamatan (and nearest desa) a point is in. Bbox candidates come from the btree, the exact test is ray casting in
 * JS (D4: no PostGIS). Returns null when the point is nowhere near any kecamatan.
 */
export async function regionLookup(prisma: PrismaClient, p: LatLng): Promise<RegionHit | null> {
  const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
  const cached = results.get(key)
  if (cached !== undefined) return cached

  const select = { code: true, name: true, kind: true, lat: true, lng: true, minLat: true, maxLat: true, minLng: true, maxLng: true, polygon: true } as const
  const candidates = await prisma.region.findMany({ where: { level: 3, minLat: { lte: p.lat }, maxLat: { gte: p.lat }, minLng: { lte: p.lng }, maxLng: { gte: p.lng } }, select, orderBy: { code: 'asc' } })
  let hit: RegionHit | null = null
  for (const c of candidates) {
    const poly = polygonOf(c)
    if (poly && pointInMultiPolygon(p, poly, { minLat: c.minLat!, maxLat: c.maxLat!, minLng: c.minLng!, maxLng: c.maxLng! })) {
      hit = await describe(prisma, c, p, 'polygon')
      break
    }
  }

  if (!hit) {
    // Off the polygons: a point on a beach or just offshore. Look at kecamatan whose box, grown by ~1 km, holds the point.
    const pad = 0.01
    const near = await prisma.region.findMany({ where: { level: 3, minLat: { lte: p.lat + pad }, maxLat: { gte: p.lat - pad }, minLng: { lte: p.lng + pad }, maxLng: { gte: p.lng - pad } }, select })
    let best: { c: Candidate; d: number } | null = null
    for (const c of near) {
      const poly = polygonOf(c)
      const d = poly ? nearEdgeMeters(p, poly) : Infinity
      if (!best || d < best.d) best = { c, d }
    }
    if (best && best.d <= SEA_FALLBACK_METERS) {
      hit = await describe(prisma, best.c, p, 'sea_fallback')
    } else {
      // Last resort: the nearest kecamatan centroid within 15 km, flagged lower confidence.
      const wide = 0.15
      const far = await prisma.region.findMany({ where: { level: 3, lat: { gte: p.lat - wide, lte: p.lat + wide }, lng: { gte: p.lng - wide, lte: p.lng + wide } }, select: { ...select, polygon: false } })
      let nearest: { c: (typeof far)[number]; d: number } | null = null
      for (const c of far) {
        const d = haversineMeters(p, { lat: c.lat, lng: c.lng })
        if (!nearest || d < nearest.d) nearest = { c, d }
      }
      if (nearest && nearest.d <= NEAREST_MAX_METERS) hit = await describe(prisma, { ...nearest.c, polygon: null }, p, 'nearest')
    }
  }
  results.set(key, hit)
  return hit
}

/** "Jakarta Barat" vs "Kota Administrasi Jakarta Barat": compare names with the administrative prefix stripped. */
export function normalizeRegionName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(kota administrasi|kabupaten administrasi|kota adm\.?|kabupaten|kab\.?|kota|kecamatan|kec\.?|kelurahan|kel\.?|desa)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Spacing-insensitive: the boundary data writes "Pal Merah" and "Gedongtengen" where the address says "Palmerah" and "Gedong Tengen". */
export function sameRegionName(a: string, b: string): boolean {
  const squash = (s: string) => normalizeRegionName(s).replace(/ /g, '')
  return squash(a) === squash(b)
}
