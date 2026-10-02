import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { averageLatLng, formatDistance, haversineMeters } from './geo.ts'

const pt = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
})

describe('haversineMeters', () => {
  it('known distance: Monas to Bundaran HI is about 2.2 km', () => {
    const d = haversineMeters({ lat: -6.1754, lng: 106.8272 }, { lat: -6.195, lng: 106.823 })
    expect(d).toBeGreaterThan(2000)
    expect(d).toBeLessThan(2400)
  })
  it('property: zero to self, symmetric, non-negative', () => {
    fc.assert(
      fc.property(pt, pt, (a, b) => {
        expect(haversineMeters(a, a)).toBe(0)
        expect(haversineMeters(a, b)).toBe(haversineMeters(b, a))
        expect(haversineMeters(a, b)).toBeGreaterThanOrEqual(0)
      }),
    )
  })
})

describe('formatDistance', () => {
  it('formats meters and km', () => {
    expect(formatDistance(450)).toBe('450 m')
    expect(formatDistance(1500)).toBe('1,5 km')
    expect(formatDistance(12000)).toBe('12 km')
    expect(formatDistance(-5)).toBe('0 m')
  })
})

describe('averageLatLng', () => {
  it('null for empty, mean otherwise', () => {
    expect(averageLatLng([])).toBeNull()
    expect(averageLatLng([{ lat: 0, lng: 0 }, { lat: 2, lng: 4 }])).toEqual({ lat: 1, lng: 2 })
  })
  it('property: average latitude lies within bounds', () => {
    fc.assert(
      fc.property(fc.array(pt, { minLength: 1, maxLength: 20 }), (pts) => {
        const m = averageLatLng(pts)!
        const lats = pts.map((p) => p.lat)
        expect(m.lat).toBeGreaterThanOrEqual(Math.min(...lats) - 1e-9)
        expect(m.lat).toBeLessThanOrEqual(Math.max(...lats) + 1e-9)
      }),
    )
  })
})
