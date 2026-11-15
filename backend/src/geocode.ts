import { addressCandidates } from '@kobo/shared/address-query'
import { haversineMeters } from '@kobo/shared/domain'
import { SEARCH_RADIUS_MAX, SEARCH_RADIUS_METERS } from '@kobo/shared/search'

/** A named place resolved from free text: where it is and how far across it is (clamped for a kos search). */
export interface Place {
  label: string
  lat: number
  lng: number
  radiusMeters: number
}

/** A street address resolved to a map point and the administrative names around it (for the owner's kos form). */
export interface AddressMatch {
  label: string
  lat: number
  lng: number
  /** Kota or kabupaten ("Jakarta Barat"); empty when the provider does not know. */
  city: string
  /** Kelurahan and kecamatan ("Pakulonan Barat, Kelapa Dua"); empty when unknown. */
  district: string
  /** `exact`: the whole address matched. `area`: the street or cluster is not on the map; the point is the centre of the named area. */
  precision: 'exact' | 'area'
}

/** Free text in, one place out (null when nothing matches). Throws GeocoderUnavailable when the provider cannot answer. */
export interface Geocoder {
  search(query: string): Promise<Place | null>
  /** A full address in, its point plus city and district out. Same throttle and cache as `search`. */
  resolveAddress(query: string): Promise<AddressMatch | null>
}

export class GeocoderUnavailable extends Error {
  constructor(message = 'Geocoder unavailable') {
    super(message)
    this.name = 'GeocoderUnavailable'
  }
}

/** Used when no provider is configured (tests, offline dev): every query is "not found", so Search falls back to text. */
export class NoGeocoder implements Geocoder {
  async search(): Promise<Place | null> {
    return null
  }
  async resolveAddress(): Promise<AddressMatch | null> {
    return null
  }
}

interface NominatimHit {
  lat: string
  lon: string
  display_name?: string
  name?: string
  boundingbox?: [string, string, string, string]
  addresstype?: string
  address?: Record<string, string | undefined>
}

export interface NominatimOptions {
  /** Public instance by default. Set GEOCODER_URL to a self-hosted or commercial Nominatim-compatible endpoint. */
  baseUrl?: string
  /** The OSM policy requires an identifying User-Agent; library defaults are refused. */
  userAgent: string
  fetchImpl?: typeof fetch
  /** Minimum gap between upstream calls. The public instance allows 1 request per second. */
  minIntervalMs?: number
  /** Callers waiting behind the throttle beyond this are refused instead of queued forever. */
  maxQueue?: number
  timeoutMs?: number
  cacheSize?: number
  positiveTtlMs?: number
  negativeTtlMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const DAY = 24 * 60 * 60 * 1000

/**
 * Nominatim geocoder for the Search box. Follows the OSM usage policy (operations.osmfoundation.org/policies/nominatim):
 * called only when the user submits a search (never as-you-type autocomplete), one request at a time at most once a
 * second, an identifying User-Agent, and every answer cached so a repeated query never reaches the provider again.
 */
export class NominatimGeocoder implements Geocoder {
  private readonly baseUrl: string
  private readonly userAgent: string
  private readonly fetchImpl: typeof fetch
  private readonly minIntervalMs: number
  private readonly maxQueue: number
  private readonly timeoutMs: number
  private readonly cacheSize: number
  private readonly positiveTtlMs: number
  private readonly negativeTtlMs: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly cache = new Map<string, { at: number; value: Place | AddressMatch | null }>()
  private readonly inflight = new Map<string, Promise<Place | AddressMatch | null>>()
  private lastCallAt = 0
  private waiting = 0
  private tail: Promise<unknown> = Promise.resolve()

  constructor(options: NominatimOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://nominatim.openstreetmap.org').replace(/\/+$/, '')
    this.userAgent = options.userAgent
    this.fetchImpl = options.fetchImpl ?? fetch
    this.minIntervalMs = options.minIntervalMs ?? 1100
    this.maxQueue = options.maxQueue ?? 4
    this.timeoutMs = options.timeoutMs ?? 4000
    this.cacheSize = options.cacheSize ?? 500
    this.positiveTtlMs = options.positiveTtlMs ?? 30 * DAY
    this.negativeTtlMs = options.negativeTtlMs ?? 60 * 60 * 1000
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async search(query: string): Promise<Place | null> {
    const key = query.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key) return null

    return this.cached(key, () => this.fetchPlace(key)) as Promise<Place | null>
  }

  /**
   * Tries the cleaned address, then ever shorter ones (see addressCandidates), each cached and throttled like any lookup.
   * The first answer wins; later candidates are never asked once one matches.
   */
  async resolveAddress(query: string): Promise<AddressMatch | null> {
    for (const candidate of addressCandidates(query)) {
      const key = `addr|${candidate.precision}|${candidate.query.toLowerCase()}`
      const match = (await this.cached(key, () => this.fetchAddress(candidate.query, candidate.precision))) as AddressMatch | null
      if (match) return match
    }
    return null
  }

  private async cached(key: string, job: () => Promise<Place | AddressMatch | null>): Promise<Place | AddressMatch | null> {
    const hit = this.cache.get(key)
    if (hit && this.now() - hit.at < (hit.value ? this.positiveTtlMs : this.negativeTtlMs)) return hit.value

    const running = this.inflight.get(key)
    if (running) return running

    const request = this.throttled(job).then((value) => {
      this.remember(key, value)
      return value
    })
    this.inflight.set(key, request)
    try {
      return await request
    } finally {
      this.inflight.delete(key)
    }
  }

  private async fetchAddress(query: string, precision: 'exact' | 'area'): Promise<AddressMatch | null> {
    const url = new URL(`${this.baseUrl}/search`)
    url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: precision === 'area' ? '5' : '1', addressdetails: '1', countrycodes: 'id', 'accept-language': 'id' }).toString()
    let hits: NominatimHit[]
    try {
      const res = await this.fetchImpl(url, { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) })
      if (!res.ok) throw new GeocoderUnavailable(`Geocoder answered ${res.status}`)
      hits = (await res.json()) as NominatimHit[]
    } catch (e) {
      throw e instanceof GeocoderUnavailable ? e : new GeocoderUnavailable(e instanceof Error ? e.message : undefined)
    }
    // A shortened query can also hit a shop or a church with the same words; only places that name an area stand for one.
    const hit = precision === 'area' ? hits.find((h) => AREA_TYPES.has(h.addresstype ?? '')) : hits[0]
    return toAddressMatch(hit, precision)
  }

  private remember(key: string, value: Place | AddressMatch | null) {
    this.cache.delete(key)
    this.cache.set(key, { at: this.now(), value })
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value as string)
  }

  /** One upstream call at a time, spaced by minIntervalMs. A full queue is refused rather than left to grow. */
  private throttled<T>(job: () => Promise<T>): Promise<T> {
    if (this.waiting >= this.maxQueue) return Promise.reject(new GeocoderUnavailable('Geocoder queue is full'))
    this.waiting += 1
    const run = this.tail.then(async () => {
      const wait = this.lastCallAt + this.minIntervalMs - this.now()
      if (wait > 0) await this.sleep(wait)
      this.lastCallAt = this.now()
      try {
        return await job()
      } finally {
        this.waiting -= 1
      }
    })
    this.tail = run.catch(() => undefined)
    return run
  }

  private async fetchPlace(query: string): Promise<Place | null> {
    const url = new URL(`${this.baseUrl}/search`)
    url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', countrycodes: 'id', 'accept-language': 'id' }).toString()
    let hits: NominatimHit[]
    try {
      const res = await this.fetchImpl(url, { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) })
      if (!res.ok) throw new GeocoderUnavailable(`Geocoder answered ${res.status}`)
      hits = (await res.json()) as NominatimHit[]
    } catch (e) {
      throw e instanceof GeocoderUnavailable ? e : new GeocoderUnavailable(e instanceof Error ? e.message : undefined)
    }
    return toPlace(hits[0])
  }
}

/** First two meaningful parts of the display name ("Serpong, Tangerang Selatan"), never the country. */
function labelOf(hit: NominatimHit): string {
  const parts = (hit.display_name ?? hit.name ?? '').split(',').map((p) => p.trim()).filter((p) => p && p.toLowerCase() !== 'indonesia')
  return (parts.slice(0, 2).join(', ') || hit.name || '').slice(0, 80)
}

/** Half the bounding box's diagonal: a district gets the default radius, a province gets most of its width. */
function radiusOf(hit: NominatimHit): number {
  const box = hit.boundingbox?.map(Number)
  if (!box || box.length !== 4 || box.some((n) => !Number.isFinite(n))) return SEARCH_RADIUS_METERS
  const [south, north, west, east] = box as [number, number, number, number]
  const half = haversineMeters({ lat: south, lng: west }, { lat: north, lng: east }) / 2
  return Math.round(Math.min(SEARCH_RADIUS_MAX, Math.max(SEARCH_RADIUS_METERS, half)))
}

function toPlace(hit: NominatimHit | undefined): Place | null {
  if (!hit) return null
  const lat = Number(hit.lat)
  const lng = Number(hit.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const label = labelOf(hit)
  if (!label) return null
  return { label, lat, lng, radiusMeters: radiusOf(hit) }
}

const AREA_TYPES = new Set(['village', 'suburb', 'hamlet', 'neighbourhood', 'quarter', 'municipality', 'city_district', 'district', 'town', 'city', 'county'])

/**
 * Indonesian administrative names sit under different keys by region, so take the first that exists:
 * kelurahan/desa = village (Tangerang) or suburb (Jakarta); kecamatan = municipality (Tangerang) or city_district (Jakarta);
 * kota/kabupaten = city or county. "Kota" is dropped ("Kota Jakarta Barat"), "Kabupaten" is kept because "Tangerang" alone
 * is ambiguous.
 */
export function toAddressMatch(hit: NominatimHit | undefined, precision: 'exact' | 'area' = 'exact'): AddressMatch | null {
  if (!hit) return null
  const lat = Number(hit.lat)
  const lng = Number(hit.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const a = hit.address ?? {}
  const first = (...keys: string[]) => keys.map((k) => a[k]?.trim()).find(Boolean) ?? ''
  const kelurahan = first('village', 'suburb', 'neighbourhood')
  const kecamatan = first('municipality', 'city_district')
  const district = [...new Set([kelurahan, kecamatan].filter(Boolean))].join(', ')
  return {
    label: (hit.display_name ?? '').split(',').slice(0, 3).join(',').trim().slice(0, 120),
    lat,
    lng,
    city: first('city', 'county', 'regency', 'town').replace(/^kota\s+/i, '').slice(0, 80),
    district: district.slice(0, 80),
    precision,
  }
}

/** GEOCODER=off disables lookups (the default in tests). Otherwise Nominatim; GEOCODER_URL swaps the endpoint. */
export function geocoderFromEnv(env: NodeJS.ProcessEnv = process.env): Geocoder {
  if (env.GEOCODER === 'off' || env.NODE_ENV === 'test') return new NoGeocoder()
  const contact = env.GEOCODER_CONTACT?.trim() || env.BETTER_AUTH_URL?.trim() || 'https://github.com/kobo'
  return new NominatimGeocoder({ baseUrl: env.GEOCODER_URL?.trim() || undefined, userAgent: `KoBo/1.0 (+${contact})` })
}
