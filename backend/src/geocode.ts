import { haversineMeters } from '@kobo/shared/domain'
import { SEARCH_RADIUS_MAX, SEARCH_RADIUS_METERS } from '@kobo/shared/search'

/** A named place resolved from free text: where it is and how far across it is (clamped for a kos search). */
export interface Place {
  label: string
  lat: number
  lng: number
  radiusMeters: number
}

/** Free text in, one place out (null when nothing matches). Throws GeocoderUnavailable when the provider cannot answer. */
export interface Geocoder {
  search(query: string): Promise<Place | null>
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
}

interface NominatimHit {
  lat: string
  lon: string
  display_name?: string
  name?: string
  boundingbox?: [string, string, string, string]
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
  private readonly cache = new Map<string, { at: number; value: Place | null }>()
  private readonly inflight = new Map<string, Promise<Place | null>>()
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

    const hit = this.cache.get(key)
    if (hit && this.now() - hit.at < (hit.value ? this.positiveTtlMs : this.negativeTtlMs)) return hit.value

    const running = this.inflight.get(key)
    if (running) return running

    const request = this.throttled(() => this.fetchPlace(key)).then((value) => {
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

  private remember(key: string, value: Place | null) {
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

/** GEOCODER=off disables lookups (the default in tests). Otherwise Nominatim; GEOCODER_URL swaps the endpoint. */
export function geocoderFromEnv(env: NodeJS.ProcessEnv = process.env): Geocoder {
  if (env.GEOCODER === 'off' || env.NODE_ENV === 'test') return new NoGeocoder()
  const contact = env.GEOCODER_CONTACT?.trim() || env.BETTER_AUTH_URL?.trim() || 'https://github.com/kobo'
  return new NominatimGeocoder({ baseUrl: env.GEOCODER_URL?.trim() || undefined, userAgent: `KoBo/1.0 (+${contact})` })
}
