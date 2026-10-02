// Search filters and their URL form. Pure (no zod) so the lazy Search chunk stays small.
// The URL is the single source of truth for Search: parse on read, serialize on write.

export const PRICE_MIN = 800_000
/** "No price filter" means the slider sits here. Defaulting below it would silently hide listings. */
export const PRICE_MAX = 3_500_000
export const PRICE_STEP = 100_000
/** Radius around a reference point (a preset area or "Lokasi Saya"). */
export const SEARCH_RADIUS_METERS = 5000
/** Hard cap on kos.search rows (spec section 10: no pagination at this scale). */
export const SEARCH_LIMIT = 200

export const GENDER_FILTERS = ['all', 'campur', 'putra', 'putri'] as const
export const SORT_KEYS = ['rating', 'price_asc', 'distance_asc'] as const
export type GenderFilter = (typeof GENDER_FILTERS)[number]
export type SortKey = (typeof SORT_KEYS)[number]

export interface SearchFilters {
  q: string
  /** Preset location id (`loc-*`) or a kos-derived area id (`area-*`); resolved to coordinates by the caller. */
  loc: string | null
  /** "Lokasi Saya": both or neither. */
  lat: number | null
  lng: number | null
  gender: GenderFilter
  maxPrice: number
  discountOnly: boolean
  surveyOnly: boolean
  sort: SortKey
}

export const DEFAULT_FILTERS: SearchFilters = {
  q: '',
  loc: null,
  lat: null,
  lng: null,
  gender: 'all',
  maxPrice: PRICE_MAX,
  discountOnly: false,
  surveyOnly: false,
  sort: 'rating',
}

const num = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Lenient: any malformed value falls back to its default, so a hand-edited URL never breaks the page. */
export function parseSearchParams(params: URLSearchParams): SearchFilters {
  const lat = num(params.get('lat'))
  const lng = num(params.get('lng'))
  const geo = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  const gender = params.get('gender') as GenderFilter | null
  const sort = params.get('sort') as SortKey | null
  const price = num(params.get('maxPrice'))
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    // A geolocation pin wins over a preset id when both are present.
    loc: geo ? null : params.get('loc') || null,
    lat: geo ? lat : null,
    lng: geo ? lng : null,
    gender: gender && GENDER_FILTERS.includes(gender) ? gender : DEFAULT_FILTERS.gender,
    maxPrice: price === null ? PRICE_MAX : Math.min(PRICE_MAX, Math.max(PRICE_MIN, Math.round(price))),
    discountOnly: params.get('discount') === '1',
    surveyOnly: params.get('survey') === '1',
    sort: sort && SORT_KEYS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
  }
}

/** Defaults are omitted, so the unfiltered Search URL is just `/search`. */
export function serializeSearchParams(filters: SearchFilters): URLSearchParams {
  const p = new URLSearchParams()
  const q = filters.q.trim()
  if (q) p.set('q', q)
  if (filters.lat !== null && filters.lng !== null) {
    p.set('lat', String(filters.lat))
    p.set('lng', String(filters.lng))
  } else if (filters.loc) {
    p.set('loc', filters.loc)
  }
  if (filters.gender !== DEFAULT_FILTERS.gender) p.set('gender', filters.gender)
  if (filters.maxPrice < PRICE_MAX) p.set('maxPrice', String(filters.maxPrice))
  if (filters.discountOnly) p.set('discount', '1')
  if (filters.surveyOnly) p.set('survey', '1')
  if (filters.sort !== DEFAULT_FILTERS.sort) p.set('sort', filters.sort)
  return p
}
