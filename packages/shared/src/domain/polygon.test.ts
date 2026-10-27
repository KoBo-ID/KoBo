import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bboxOf, pointInMultiPolygon, pointInPolygon, type MultiPolygonCoords } from './polygon.ts'

// [lng, lat] squares: outer 0..10, hole 4..6
const outer: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
const hole: [number, number][] = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]

describe('pointInPolygon', () => {
  it('is inside the outer ring and outside a hole', () => {
    expect(pointInPolygon({ lat: 2, lng: 2 }, [outer, hole])).toBe(true)
    expect(pointInPolygon({ lat: 5, lng: 5 }, [outer, hole])).toBe(false)
    expect(pointInPolygon({ lat: 11, lng: 5 }, [outer, hole])).toBe(false)
  })

  it('accepts an open ring', () => {
    expect(pointInPolygon({ lat: 5, lng: 5 }, [outer.slice(0, 4)])).toBe(true)
  })

  it('handles a multipolygon and uses the bbox as a prefilter', () => {
    const multi: MultiPolygonCoords = [[outer], [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]]
    const bb = bboxOf(multi)!
    expect(bb).toEqual({ minLat: 0, maxLat: 30, minLng: 0, maxLng: 30 })
    expect(pointInMultiPolygon({ lat: 25, lng: 25 }, multi, bb)).toBe(true)
    expect(pointInMultiPolygon({ lat: 15, lng: 15 }, multi, bb)).toBe(false)
    expect(pointInMultiPolygon({ lat: 5, lng: 5 }, multi, { minLat: 50, maxLat: 60, minLng: 50, maxLng: 60 })).toBe(false)
  })

  it('agrees with a plain rectangle test for an axis-aligned square', () => {
    fc.assert(
      fc.property(fc.double({ min: -5, max: 15, noNaN: true }), fc.double({ min: -5, max: 15, noNaN: true }), (lng, lat) => {
        fc.pre(lat !== 0 && lat !== 10 && lng !== 0 && lng !== 10)
        expect(pointInPolygon({ lat, lng }, [outer])).toBe(lat > 0 && lat < 10 && lng > 0 && lng < 10)
      }),
    )
  })

  it('bboxOf returns null for nothing', () => {
    expect(bboxOf([])).toBeNull()
  })
})
