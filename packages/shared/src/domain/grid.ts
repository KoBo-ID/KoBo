import type { LatLng } from './geo.ts'

/** Grid cells are 0.01 degree (about 1.1 km north-south). The key is stored on PlaceCatalog.cell and indexed. */
export const GRID_DEGREES = 0.01
const METERS_PER_DEGREE_LAT = 111_320
/** A safety stop: a radius this large would mean a bug, not a query. */
const MAX_CELLS = 900

const idx = (deg: number) => Math.floor(deg / GRID_DEGREES + 1e-9)

export const cellKey = (latIdx: number, lngIdx: number) => `${latIdx}:${lngIdx}`

export const gridCell = (lat: number, lng: number): string => cellKey(idx(lat), idx(lng))

/** Every cell whose area can hold a point within `radiusMeters` of the centre (a rectangle, so a superset of the circle). */
export function neighbourCells(lat: number, lng: number, radiusMeters: number): string[] {
  const dLat = radiusMeters / METERS_PER_DEGREE_LAT
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180))
  const dLng = radiusMeters / (METERS_PER_DEGREE_LAT * cosLat)
  const latLo = idx(lat - dLat)
  const latHi = idx(lat + dLat)
  const lngLo = idx(lng - dLng)
  const lngHi = idx(lng + dLng)
  if ((latHi - latLo + 1) * (lngHi - lngLo + 1) > MAX_CELLS) throw new RangeError('radius too large for a cell lookup')
  const out: string[] = []
  for (let a = latLo; a <= latHi; a++) for (let b = lngLo; b <= lngHi; b++) out.push(cellKey(a, b))
  return out
}

export const cellOf = (p: LatLng) => gridCell(p.lat, p.lng)
