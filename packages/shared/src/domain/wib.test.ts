import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { addDays, addMonths, compareDates, todayWIB } from './wib.ts'

const dateArb = fc
  .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10))

describe('todayWIB', () => {
  it('uses UTC+7', () => {
    expect(todayWIB(new Date('2026-10-15T16:59:59.999Z'))).toBe('2026-10-15')
    expect(todayWIB(new Date('2026-10-15T17:00:00.000Z'))).toBe('2026-10-16')
  })
  it('crosses year boundary', () => {
    expect(todayWIB(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01')
  })
  it('matches a plain +7h shift for any instant', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }),
        (d) => {
          expect(todayWIB(d)).toBe(new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10))
        },
      ),
    )
  })
})

describe('compareDates', () => {
  it('orders strings', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBeLessThan(0)
    expect(compareDates('2026-01-02', '2026-01-01')).toBeGreaterThan(0)
    expect(compareDates('2026-01-01', '2026-01-01')).toBe(0)
  })
})

describe('addDays', () => {
  it('handles month and year rollover and leap years', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('is invertible and monotonic', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -1000, max: 1000 }), (d, n) => {
        expect(addDays(addDays(d, n), -n)).toBe(d)
        expect(Math.sign(compareDates(addDays(d, n), d))).toBe(Math.sign(n))
      }),
    )
  })
})

describe('addMonths', () => {
  it('adds months and clamps to month end', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28')
    expect(addMonths('2026-03-10', -3)).toBe('2025-12-10')
  })
  it('keeps a valid date and moves the right number of months', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -60, max: 60 }), (d, n) => {
        const r = addMonths(d, n)
        expect(r).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        const idx = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7))
        expect(idx(r) - idx(d)).toBe(n)
        expect(Number(r.slice(8))).toBeLessThanOrEqual(Number(d.slice(8)))
      }),
    )
  })
})
