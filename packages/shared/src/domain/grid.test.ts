import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { haversineMeters } from './geo.ts'
import { gridCell, neighbourCells } from './grid.ts'

describe('gridCell', () => {
  it('floors to 0.01 degree, also in the southern hemisphere', () => {
    expect(gridCell(-6.2573, 106.6182)).toBe('-626:10661')
    expect(gridCell(0.004, 0.009)).toBe('0:0')
    expect(gridCell(-0.004, -0.009)).toBe('-1:-1')
  })

  it('is stable for points in the same cell', () => {
    expect(gridCell(-6.2511, 106.6111)).toBe(gridCell(-6.2599, 106.6199))
  })
})

describe('neighbourCells', () => {
  it('always contains the cell of the centre', () => {
    fc.assert(
      fc.property(fc.double({ min: -11, max: 6, noNaN: true }), fc.double({ min: 95, max: 141, noNaN: true }), fc.integer({ min: 50, max: 8000 }), (lat, lng, r) => {
        expect(neighbourCells(lat, lng, r)).toContain(gridCell(lat, lng))
      }),
    )
  })

  it('covers every point within the radius', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 5, noNaN: true }),
        fc.double({ min: 96, max: 140, noNaN: true }),
        fc.integer({ min: 100, max: 3000 }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        (lat, lng, r, ang, frac) => {
          const d = r * frac
          const p = { lat: lat + (d * Math.sin(ang)) / 111320, lng: lng + (d * Math.cos(ang)) / (111320 * Math.cos((lat * Math.PI) / 180)) }
          fc.pre(haversineMeters({ lat, lng }, p) <= r)
          expect(neighbourCells(lat, lng, r)).toContain(gridCell(p.lat, p.lng))
        },
      ),
    )
  })

  it('refuses an absurd radius', () => {
    expect(() => neighbourCells(-6, 106, 2_000_000)).toThrow(RangeError)
  })
})
