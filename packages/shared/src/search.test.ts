import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  GENDER_FILTERS,
  PRICE_MAX,
  PRICE_MIN,
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
      lat: null,
      lng: null,
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
    lat: fc.option(fc.double({ min: -90, max: 90, noNaN: true }).map((n) => n + 0), { nil: null }),
    lng: fc.option(fc.double({ min: -180, max: 180, noNaN: true }).map((n) => n + 0), { nil: null }),
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
        const expected: SearchFilters = { ...f, lat: geo ? f.lat : null, lng: geo ? f.lng : null, loc: geo ? null : f.loc }
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

  it('requires lat and lng together', () => {
    expect(kosSearchInput.safeParse({ lat: -6.2 }).success).toBe(false)
    expect(kosSearchInput.safeParse({ lat: -6.2, lng: 106.8, locationLabel: 'Kemanggisan' }).success).toBe(true)
  })

  it('rejects out-of-range values', () => {
    expect(kosSearchInput.safeParse({ lat: 100, lng: 0 }).success).toBe(false)
    expect(kosSearchInput.safeParse({ sort: 'newest' }).success).toBe(false)
    expect(kosSearchInput.safeParse({ maxPrice: -1 }).success).toBe(false)
  })
})
