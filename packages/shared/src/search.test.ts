import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  GENDER_FILTERS,
  PRICE_MAX,
  PRICE_MIN,
  SEARCH_RADIUS_MAX,
  SEARCH_RADIUS_MIN,
  SORT_KEYS,
  parseSearchParams,
  serializeSearchParams,
  type SearchFilters,
} from './search.ts'
import { kosSearchInput } from './schemas.ts'

const parse = (qs: string) => parseSearchParams(new URLSearchParams(qs))

describe('parseSearchParams', () => {
  it('returns the defaults for an empty query string', () => {
    expect(parse('')).toEqual(DEFAULT_FILTERS)
  })

  it('defaults maxPrice to PRICE_MAX so the Filter badge does not count a permanent filter', () => {
    expect(DEFAULT_FILTERS.maxPrice).toBe(PRICE_MAX)
    expect(PRICE_MAX).toBe(3_500_000)
  })

  it('reads every supported key', () => {
    expect(parse('q=anggrek&loc=loc-dago&gender=putri&maxPrice=2000000&discount=1&survey=1&sort=price_asc')).toEqual({
      q: 'anggrek',
      loc: 'loc-dago',
      campus: null,
      lat: null,
      lng: null,
      place: null,
      radius: null,
      region: null,
      gender: 'putri',
      maxPrice: 2_000_000,
      discountOnly: true,
      surveyOnly: true,
      sort: 'price_asc',
    })
  })

  it('lets a geolocation pin win over a preset id', () => {
    expect(parse('loc=loc-dago&lat=-6.2&lng=106.8')).toMatchObject({ loc: null, lat: -6.2, lng: 106.8 })
  })

  it('gives campus precedence over loc while coordinates still win over campus', () => {
    expect(parse('loc=loc-dago&campus=itb-ganesha')).toMatchObject({ loc: null, campus: 'itb-ganesha' })
    expect(parse('campus=itb-ganesha&lat=-6.9&lng=107.6')).toMatchObject({ campus: null, lat: -6.9, lng: 107.6 })
    expect(serializeSearchParams({ ...DEFAULT_FILTERS, campus: 'itb-ganesha' }).get('campus')).toBe('itb-ganesha')
  })

  it('falls back to defaults for malformed values', () => {
    expect(parse('gender=x&sort=y&maxPrice=abc&lat=1&discount=yes')).toEqual(DEFAULT_FILTERS)
    expect(parse('lat=999&lng=0').lat).toBeNull()
  })

  it('clamps maxPrice into the slider range', () => {
    expect(parse('maxPrice=99999999').maxPrice).toBe(PRICE_MAX)
    expect(parse('maxPrice=1').maxPrice).toBe(PRICE_MIN)
  })
})

describe('serializeSearchParams', () => {
  it('omits defaults', () => {
    expect(serializeSearchParams(DEFAULT_FILTERS).toString()).toBe('')
  })

  it('drops maxPrice at the maximum', () => {
    expect(serializeSearchParams({ ...DEFAULT_FILTERS, maxPrice: PRICE_MAX }).has('maxPrice')).toBe(false)
    expect(serializeSearchParams({ ...DEFAULT_FILTERS, maxPrice: 1_000_000 }).get('maxPrice')).toBe('1000000')
  })

  const filters = fc.record({
    q: fc.string({ maxLength: 40 }).map((s) => s.trim()),
    loc: fc.option(fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/), { nil: null }),
    campus: fc.option(fc.stringMatching(/^[a-z][a-z0-9-]{0,30}$/), { nil: null }),
    lat: fc.option(fc.double({ min: -90, max: 90, noNaN: true }).map((n) => n + 0), { nil: null }),
    lng: fc.option(fc.double({ min: -180, max: 180, noNaN: true }).map((n) => n + 0), { nil: null }),
    place: fc.option(fc.string({ minLength: 1, maxLength: 30 }).map((s) => s.trim()).filter((s) => s.length > 0), { nil: null }),
    radius: fc.option(fc.integer({ min: SEARCH_RADIUS_MIN, max: SEARCH_RADIUS_MAX }), { nil: null }),
    region: fc.option(fc.constantFrom('36', '32.73', '31.74.01'), { nil: null }),
    gender: fc.constantFrom(...GENDER_FILTERS),
    maxPrice: fc.integer({ min: PRICE_MIN, max: PRICE_MAX }),
    discountOnly: fc.boolean(),
    surveyOnly: fc.boolean(),
    sort: fc.constantFrom(...SORT_KEYS),
  })

  it('round-trips through parse (lat/lng are a pair; a geo pin replaces loc)', () => {
    fc.assert(
      fc.property(filters, (f: SearchFilters) => {
        const geo = f.lat !== null && f.lng !== null
        const expected: SearchFilters = { ...f, lat: geo ? f.lat : null, lng: geo ? f.lng : null, loc: geo || f.campus ? null : f.loc, campus: geo ? null : f.campus, place: geo ? f.place : null, radius: geo ? f.radius : null, region: geo || f.campus || f.loc ? null : f.region }
        expect(parseSearchParams(serializeSearchParams(f))).toEqual(expected)
      }),
    )
  })
})

describe('kosSearchInput', () => {
  it('applies the Search defaults to an empty input', () => {
    expect(kosSearchInput.parse({})).toEqual({
      q: '',
      gender: 'all',
      maxPrice: PRICE_MAX,
      discountOnly: false,
      surveyOnly: false,
      sort: 'rating',
    })
  })

  it('keeps a place name and radius only with a map point, and clamps the radius', () => {
    expect(parse('lat=-6.2&lng=106.8&place=Banten&r=80000')).toMatchObject({ lat: -6.2, place: 'Banten', radius: 80000 })
    expect(parse('place=Banten&r=80000')).toMatchObject({ place: null, radius: null })
    expect(parse('lat=-6.2&lng=106.8&r=5')).toMatchObject({ radius: SEARCH_RADIUS_MIN })
    expect(parse('lat=-6.2&lng=106.8&r=9999999')).toMatchObject({ radius: SEARCH_RADIUS_MAX })
    expect(parse('lat=-6.2&lng=106.8&place=%20%20')).toMatchObject({ place: null })
  })

  it('requires lat and lng together', () => {
    expect(kosSearchInput.safeParse({ lat: -6.2 }).success).toBe(false)
    expect(kosSearchInput.safeParse({ lat: -6.2, lng: 106.8, locationLabel: 'Kemanggisan' }).success).toBe(true)
  })

  it('rejects out-of-range values', () => {
    expect(kosSearchInput.safeParse({ lat: 100, lng: 0 }).success).toBe(false)
    expect(kosSearchInput.safeParse({ lat: 0, lng: 0, radius: 10 }).success).toBe(false)
    expect(kosSearchInput.safeParse({ lat: 0, lng: 0, radius: 50_000 }).success).toBe(true)
    expect(kosSearchInput.safeParse({ sort: 'newest' }).success).toBe(false)
    expect(kosSearchInput.safeParse({ maxPrice: -1 }).success).toBe(false)
  })
})

describe('region search', () => {
  it('parses and serializes a region code, and drops malformed ones', () => {
    expect(parse('region=36')).toMatchObject({ region: '36' })
    expect(parse('region=36.74.03')).toMatchObject({ region: '36.74.03' })
    expect(parse('region=banten')).toMatchObject({ region: null })
    expect(serializeSearchParams({ ...DEFAULT_FILTERS, region: '36' }).toString()).toBe('region=36')
  })

  it('ranks below a pin, a campus and a preset location, and never carries a radius', () => {
    expect(parse('region=36&lat=-6.2&lng=106.8')).toMatchObject({ region: null })
    expect(parse('region=36&campus=ui-depok')).toMatchObject({ region: null })
    expect(parse('region=36&loc=loc-bsd')).toMatchObject({ region: null })
    expect(parse('region=36&r=50000')).toMatchObject({ region: '36', radius: null })
  })
})
