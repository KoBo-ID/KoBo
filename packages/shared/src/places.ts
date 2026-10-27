// Place catalogue rules shared by the server (ranking, radii) and, later, the client (labels). Pure, no zod.

export const PLACE_CATEGORY_IDS = ['campus', 'food', 'minimarket', 'laundry', 'print', 'atm', 'pharmacy', 'clinic', 'hospital', 'worship', 'gym', 'cafe', 'transit', 'pasar'] as const
export type PlaceCategoryId = (typeof PLACE_CATEGORY_IDS)[number]

export type TravelMode = 'walk' | 'motor'

export interface PlaceCategory {
  id: PlaceCategoryId
  label: string
  /** Metres. Inside this radius a place is shown straight away. */
  primaryRadius: number
  /** Metres. Out to this radius it is behind "tampilkan lebih banyak". */
  moreRadius: number
  /** Places shown per step (primary, then show-more). */
  cap: number
  /** `auto` means walk up to 1,500 m and motorbike beyond (campus). */
  mode: TravelMode | 'auto'
}

// Radii are judgement values (notes/data-gathering/radius-table.md); Walk Score's 400 m / 5 min zone is the only sourced anchor.
export const PLACE_CATEGORIES: readonly PlaceCategory[] = [
  { id: 'campus', label: 'Kampus', primaryRadius: 1500, moreRadius: 5000, cap: 5, mode: 'auto' },
  { id: 'food', label: 'Makan', primaryRadius: 500, moreRadius: 1000, cap: 5, mode: 'walk' },
  { id: 'minimarket', label: 'Minimarket', primaryRadius: 400, moreRadius: 800, cap: 5, mode: 'walk' },
  { id: 'laundry', label: 'Laundry', primaryRadius: 500, moreRadius: 1000, cap: 5, mode: 'walk' },
  { id: 'print', label: 'Fotokopi & print', primaryRadius: 500, moreRadius: 1000, cap: 5, mode: 'walk' },
  { id: 'atm', label: 'ATM & bank', primaryRadius: 800, moreRadius: 2000, cap: 5, mode: 'walk' },
  { id: 'pharmacy', label: 'Apotek', primaryRadius: 1000, moreRadius: 3000, cap: 5, mode: 'motor' },
  { id: 'clinic', label: 'Klinik', primaryRadius: 1000, moreRadius: 3000, cap: 5, mode: 'motor' },
  { id: 'hospital', label: 'Rumah sakit', primaryRadius: 3000, moreRadius: 8000, cap: 5, mode: 'motor' },
  { id: 'worship', label: 'Tempat ibadah', primaryRadius: 500, moreRadius: 1500, cap: 5, mode: 'walk' },
  { id: 'gym', label: 'Olahraga', primaryRadius: 1000, moreRadius: 3000, cap: 5, mode: 'motor' },
  { id: 'cafe', label: 'Kafe & coworking', primaryRadius: 800, moreRadius: 2000, cap: 5, mode: 'walk' },
  { id: 'transit', label: 'Transportasi umum', primaryRadius: 1000, moreRadius: 3000, cap: 5, mode: 'walk' },
  { id: 'pasar', label: 'Pasar', primaryRadius: 1500, moreRadius: 4000, cap: 5, mode: 'motor' },
]

const BY_ID = new Map<string, PlaceCategory>(PLACE_CATEGORIES.map((c) => [c.id, c]))

export const isPlaceCategory = (id: string): id is PlaceCategoryId => BY_ID.has(id)
export const placeCategory = (id: string): PlaceCategory | undefined => BY_ID.get(id)

/** The widest radius any category needs, in metres (used to bound one cell lookup). */
export const MAX_PLACE_RADIUS = Math.max(...PLACE_CATEGORIES.map((c) => c.moreRadius))

const WALK_METERS_PER_MIN = 80
const MOTOR_METERS_PER_MIN = 400
const AUTO_WALK_LIMIT = 1500

/** Estimates from straight-line distance, never a route. Always at least one minute. */
export const walkMinutes = (meters: number): number => Math.max(1, Math.round(meters / WALK_METERS_PER_MIN))
export const motorMinutes = (meters: number): number => Math.max(1, Math.round(meters / MOTOR_METERS_PER_MIN))

export function modeFor(category: PlaceCategoryId, meters: number): TravelMode {
  const c = BY_ID.get(category)
  if (!c || c.mode === 'walk') return 'walk'
  if (c.mode === 'motor') return 'motor'
  return meters > AUTO_WALK_LIMIT ? 'motor' : 'walk'
}

export const minutesFor = (mode: TravelMode, meters: number): number => (mode === 'walk' ? walkMinutes(meters) : motorMinutes(meters))

/** "5 mnt jalan kaki (perkiraan, garis lurus)" - the label the UI must show with the number. */
export const modeLabel = (mode: TravelMode): string => (mode === 'walk' ? 'jalan kaki' : 'motor')
export const DISTANCE_NOTE = 'garis lurus'

export interface RankablePlace {
  id: string
  name: string | null
  brand: string | null
  /** Quality score from the importer (0 to 6). */
  score: number
  distanceM: number
}

export interface RankedPlaces<T extends RankablePlace> {
  primary: T[]
  more: T[]
}

const SCORE_WEIGHT = 0.15
/** Lower is better. A higher score shrinks the effective distance, so a well-described place a bit further away can win. */
const rankKey = (p: RankablePlace) => p.distanceM / (1 + SCORE_WEIGHT * Math.max(0, p.score))
const MAX_PER_BRAND = 2
/** The same business can be in two sources (OSM and Overture are never merged in the database); at display time one copy is enough. */
const SAME_PLACE_METERS = 60
const nameKey = (n: string) => n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')

/**
 * Per category: named places only, ranked by score-weighted distance, at most two per brand across both lists, the
 * primary list limited to places inside the primary radius (cap `cap`) and the show-more list to the rest inside the
 * wider radius (cap `cap`).
 */
export function rankPlaces<T extends RankablePlace>(places: readonly T[], category: PlaceCategory): RankedPlaces<T> {
  const named = places.filter((p) => p.name && p.name.trim().length > 0 && p.distanceM <= category.moreRadius)
  const sorted = [...named].sort((a, b) => rankKey(a) - rankKey(b) || a.distanceM - b.distanceM || a.id.localeCompare(b.id))
  const perBrand = new Map<string, number>()
  const kept: T[] = []
  for (const p of sorted) {
    const key = nameKey(p.name!)
    if (key && kept.some((k) => nameKey(k.name!) === key && Math.abs(k.distanceM - p.distanceM) <= SAME_PLACE_METERS)) continue
    const brand = p.brand?.trim().toLowerCase()
    if (brand) {
      const n = perBrand.get(brand) ?? 0
      if (n >= MAX_PER_BRAND) continue
      perBrand.set(brand, n + 1)
    }
    kept.push(p)
  }
  const primary = kept.filter((p) => p.distanceM <= category.primaryRadius).slice(0, category.cap)
  const taken = new Set(primary.map((p) => p.id))
  const more = kept.filter((p) => !taken.has(p.id)).slice(0, category.cap)
  return { primary, more }
}

/** Owner-added text must not carry contact details (UU PDP) or links. */
export function isPhoneLike(text: string): boolean {
  const squeezed = text.replace(/[\s().-]/g, '')
  return /(\+?62|0)\d{7,}/.test(squeezed) || /\d{8,}/.test(squeezed)
}

export function isUrlLike(text: string): boolean {
  return /(https?:\/\/|www\.|\bwa\.me|\bt\.me|\b[a-z0-9-]+\.(com|co\.id|id|net|org|io|me|link|ly|app|xyz)\b|(^|\s)@[a-z0-9_.]{3,})/i.test(text)
}

/** The licence lines the UI shows next to a places list (attribution-spec.md). */
export const OSM_ATTRIBUTION = { text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' } as const
