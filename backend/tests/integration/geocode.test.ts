import { describe, expect, it } from 'vitest'
import { GeocoderUnavailable, NominatimGeocoder } from '../../src/geocode.ts'
import { createCallerFactory } from '../../src/trpc/trpc.ts'
import { appRouter } from '../../src/trpc/router.ts'
import { auth, paymentService, prisma } from '../helpers.ts'
import { createFakeStorage } from '../../src/storage.ts'

const BANTEN = { lat: '-6.4', lon: '106.0', display_name: 'Banten, Indonesia', boundingbox: ['-7.0', '-5.8', '105.1', '106.8'] }
const SERPONG = { lat: '-6.3', lon: '106.67', display_name: 'Serpong, Tangerang Selatan, Banten, Indonesia', boundingbox: ['-6.33', '-6.27', '106.64', '106.7'] }

function harness(responses: unknown[][], over: { status?: number; fail?: boolean } = {}) {
  let clock = 1_000_000
  const calls: URL[] = []
  const headers: unknown[] = []
  const sleeps: number[] = []
  const fetchImpl = (async (url: URL, init?: RequestInit) => {
    calls.push(url)
    headers.push(init?.headers)
    if (over.fail) throw new Error('network down')
    return new Response(JSON.stringify(responses[Math.min(calls.length - 1, responses.length - 1)]), { status: over.status ?? 200 })
  }) as unknown as typeof fetch
  const geocoder = new NominatimGeocoder({
    userAgent: 'KoBo/test',
    fetchImpl,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
  })
  return { geocoder, calls, headers, sleeps, advance: (ms: number) => (clock += ms) }
}

describe('NominatimGeocoder', () => {
  it('turns free text into a labelled point and asks only for Indonesia, one result, in Indonesian', async () => {
    const h = harness([[SERPONG]])
    const place = await h.geocoder.search('serpong')
    expect(place).toMatchObject({ label: 'Serpong, Tangerang Selatan', lat: -6.3, lng: 106.67 })
    const q = h.calls[0]!.searchParams
    expect([q.get('q'), q.get('countrycodes'), q.get('limit'), q.get('format'), q.get('accept-language')]).toEqual(['serpong', 'id', '1', 'jsonv2', 'id'])
    expect((h.headers[0] as Record<string, string>)['User-Agent']).toBe('KoBo/test')
  })

  it('widens the radius with the place: a district keeps the default, a province gets most of its width', async () => {
    const district = await harness([[SERPONG]]).geocoder.search('serpong')
    const province = await harness([[BANTEN]]).geocoder.search('banten')
    expect(district!.radiusMeters).toBe(5000)
    expect(province!.radiusMeters).toBeGreaterThan(60_000)
    expect(province!.radiusMeters).toBeLessThanOrEqual(100_000)
    expect(province!.label).toBe('Banten')
  })

  it('answers a repeated query from cache, ignoring case and spacing', async () => {
    const h = harness([[BANTEN]])
    await h.geocoder.search('Banten')
    await h.geocoder.search('  banten ')
    await h.geocoder.search('BANTEN')
    expect(h.calls).toHaveLength(1)
  })

  it('shares one upstream call between simultaneous identical queries', async () => {
    const h = harness([[BANTEN]])
    await Promise.all([h.geocoder.search('banten'), h.geocoder.search('banten')])
    expect(h.calls).toHaveLength(1)
  })

  it('spaces different queries at least a second apart', async () => {
    const h = harness([[BANTEN], [SERPONG]])
    await h.geocoder.search('banten')
    await h.geocoder.search('serpong')
    expect(h.calls).toHaveLength(2)
    expect(h.sleeps.length).toBeGreaterThan(0)
    expect(Math.max(...h.sleeps)).toBeGreaterThanOrEqual(1000)
  })

  it('caches a miss for a while, then asks again', async () => {
    const h = harness([[], [BANTEN]])
    expect(await h.geocoder.search('zzzz')).toBeNull()
    expect(await h.geocoder.search('zzzz')).toBeNull()
    expect(h.calls).toHaveLength(1)
    h.advance(2 * 60 * 60 * 1000)
    expect(await h.geocoder.search('zzzz')).not.toBeNull()
    expect(h.calls).toHaveLength(2)
  })

  it('reports an outage instead of caching it', async () => {
    const down = harness([[]], { fail: true })
    await expect(down.geocoder.search('banten')).rejects.toBeInstanceOf(GeocoderUnavailable)
    const refused = harness([[]], { status: 429 })
    await expect(refused.geocoder.search('banten')).rejects.toBeInstanceOf(GeocoderUnavailable)
    await expect(refused.geocoder.search('banten')).rejects.toBeInstanceOf(GeocoderUnavailable)
    expect(refused.calls).toHaveLength(2)
  })
})

describe('NominatimGeocoder.resolveAddress', () => {
  const JAKARTA = {
    lat: '-6.2008', lon: '106.7861', display_name: 'Jalan KH Syahdan 28, Kemanggisan, Palmerah, Jakarta Barat, Indonesia',
    address: { road: 'Jalan KH Syahdan', suburb: 'Kemanggisan', city_district: 'Palmerah', city: 'Kota Jakarta Barat', state: 'Daerah Khusus Ibukota Jakarta' },
  }

  it('returns the point with city and kecamatan, asking for address details', async () => {
    const h = harness([[JAKARTA]])
    const match = await h.geocoder.resolveAddress('Jl. KH Syahdan 28')
    expect(match).toMatchObject({ lat: -6.2008, lng: 106.7861, city: 'Jakarta Barat', district: 'Kemanggisan, Palmerah', precision: 'exact' })
    expect(h.calls[0]!.searchParams.get('addressdetails')).toBe('1')
  })

  it('leaves city and district empty when the provider does not know them, and caches the answer', async () => {
    const h = harness([[{ lat: '-6.3', lon: '106.6', display_name: 'Somewhere', address: {} }]])
    expect(await h.geocoder.resolveAddress('somewhere far')).toMatchObject({ city: '', district: '' })
    await h.geocoder.resolveAddress('Somewhere  FAR')
    expect(h.calls).toHaveLength(1)
  })

  it('falls back from a cluster nobody mapped to the kelurahan, and says the point is an area', async () => {
    const CHURCH = { lat: '-6.25', lon: '106.62', display_name: 'Gereja X, Gading Serpong', addresstype: 'amenity', address: { village: 'Pakulonan Barat' } }
    const VILLAGE = { lat: '-6.2412', lon: '106.6205', display_name: 'Pakulonan Barat, Kelapa Dua, Kabupaten Tangerang, Banten', addresstype: 'village', address: { village: 'Pakulonan Barat', municipality: 'Kelapa Dua', county: 'Kabupaten Tangerang', suburb: 'Gading Serpong' } }
    const h = harness([[], [CHURCH], [VILLAGE]])
    const match = await h.geocoder.resolveAddress('Cluster Fluorite Blok FB No.27 Summarecon Serpong, Kelurahan Pakulonan Barat, Kecamatan Kelapa Dua, Tangerang')
    expect(match).toMatchObject({ precision: 'area', city: 'Kabupaten Tangerang', district: 'Pakulonan Barat, Kelapa Dua', lat: -6.2412 })
    expect(h.calls[0]!.searchParams.get('q')).toBe('Cluster Fluorite Summarecon Serpong, Pakulonan Barat, Kelapa Dua, Tangerang')
    expect(h.calls).toHaveLength(3)
  })

  it('returns null for an unknown address', async () => {
    expect(await harness([[]]).geocoder.resolveAddress('zzzz qqqq')).toBeNull()
  })
})

describe('place.search', () => {
  const callerWith = (geocoder: { search: (q: string) => Promise<unknown> }) =>
    createCallerFactory(appRouter)({ prisma, auth, storage: createFakeStorage(), paymentService, geocoder: geocoder as never, headers: new Headers(), resHeaders: new Headers(), getSession: async () => null })

  it('returns the geocoder place, or null when unknown', async () => {
    const place = { label: 'Banten', lat: -6.4, lng: 106, radiusMeters: 80_000 }
    expect(await callerWith({ search: async () => place }).place.search({ q: 'banten' })).toEqual(place)
    expect(await callerWith({ search: async () => null }).place.search({ q: 'zzzz' })).toBeNull()
  })

  it('turns a provider outage into a clear Indonesian error', async () => {
    const failing = callerWith({ search: async () => { throw new GeocoderUnavailable() } })
    await expect(failing.place.search({ q: 'banten' })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: expect.stringContaining('Pencarian lokasi') })
  })

  it('rejects an empty or one-letter query', async () => {
    await expect(callerWith({ search: async () => null }).place.search({ q: 'b' })).rejects.toBeDefined()
  })
})
