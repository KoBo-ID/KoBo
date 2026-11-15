import type { LatLng } from './geo.ts'

/** GeoJSON order: [lng, lat]. A ring is closed or open (both work). A polygon is an outer ring followed by holes. */
export type Ring = [number, number][]
export type PolygonCoords = Ring[]
export type MultiPolygonCoords = PolygonCoords[]

export interface BBox {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export const inBBox = (p: LatLng, b: BBox): boolean => p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng

export function bboxOf(multi: MultiPolygonCoords): BBox | null {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const poly of multi) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
      }
    }
  }
  return Number.isFinite(minLat) ? { minLat, maxLat, minLng, maxLng } : null
}

/** Ray casting. A point exactly on an edge may fall on either side; callers treat the border as ambiguous. */
function inRing(p: LatLng, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Inside the outer ring and outside every hole. */
export function pointInPolygon(p: LatLng, polygon: PolygonCoords): boolean {
  const [outer, ...holes] = polygon
  if (!outer || !inRing(p, outer)) return false
  return !holes.some((h) => inRing(p, h))
}

/** `bbox` is an optional prefilter (stored on the Region row) so most candidates are rejected without touching the ring. */
export function pointInMultiPolygon(p: LatLng, multi: MultiPolygonCoords, bbox?: BBox): boolean {
  if (bbox && !inBBox(p, bbox)) return false
  return multi.some((poly) => pointInPolygon(p, poly))
}
