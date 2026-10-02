import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { computeCheckoutTotal } from './pricing.ts'

describe('computeCheckoutTotal', () => {
  it('applies discount when verified', () => {
    expect(
      computeCheckoutTotal({ monthlyRent: 1_000_000, applicationFee: 50_000, discountAmount: 100_000, campusEmailVerified: true }),
    ).toEqual({ rent: 1_000_000, applicationFee: 50_000, discount: 100_000, total: 950_000 })
  })
  it('ignores discount when unverified', () => {
    expect(
      computeCheckoutTotal({ monthlyRent: 1_000_000, applicationFee: 50_000, discountAmount: 100_000, campusEmailVerified: false }).total,
    ).toBe(1_050_000)
  })
  it('discount larger than rent+fee is capped, total 0', () => {
    expect(computeCheckoutTotal({ monthlyRent: 100, applicationFee: 0, discountAmount: 500, campusEmailVerified: true })).toEqual({
      rent: 100,
      applicationFee: 0,
      discount: 100,
      total: 0,
    })
  })

  const arb = fc.record({
    monthlyRent: fc.integer({ min: 0, max: 50_000_000 }),
    applicationFee: fc.integer({ min: 0, max: 1_000_000 }),
    discountAmount: fc.integer({ min: 0, max: 100_000_000 }),
    campusEmailVerified: fc.boolean(),
  })
  it('property: total >= 0, integer, total = rent + fee - discount', () => {
    fc.assert(
      fc.property(arb, (i) => {
        const r = computeCheckoutTotal(i)
        expect(r.total).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(r.total)).toBe(true)
        expect(r.total).toBe(r.rent + r.applicationFee - r.discount)
        expect(r.discount).toBeLessThanOrEqual(i.discountAmount)
      }),
    )
  })
  it('property: unverified implies discount 0', () => {
    fc.assert(
      fc.property(arb, (i) => {
        expect(computeCheckoutTotal({ ...i, campusEmailVerified: false }).discount).toBe(0)
      }),
    )
  })
})
