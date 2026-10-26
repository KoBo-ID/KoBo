import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { computeCheckoutTotal, leaseQuote } from './pricing.ts'

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

describe('leaseQuote', () => {
  const input = { monthlyRent: 1_650_000, applicationFee: 25_000, discountAmount: 150_000, campusEmailVerified: true, months: 3 }

  it('discounts only the first invoice for a verified student', () => {
    expect(leaseQuote(input)).toEqual({ rent: 1_650_000, applicationFee: 25_000, discount: 150_000, firstPayment: 1_525_000, laterMonths: 2, laterTotal: 3_300_000, leaseTotal: 4_825_000 })
  })
  it('does not discount an unverified student', () => {
    expect(leaseQuote({ ...input, campusEmailVerified: false })).toMatchObject({ firstPayment: 1_675_000, discount: 0, leaseTotal: 4_975_000 })
  })
  it('has no later invoices for a one-month lease', () => {
    const quote = leaseQuote({ ...input, months: 1 })
    expect(quote.laterMonths).toBe(0)
    expect(quote.leaseTotal).toBe(quote.firstPayment)
  })
  it('clamps months to 1..12', () => {
    expect(leaseQuote({ ...input, months: 99 }).laterMonths).toBe(11)
    expect(leaseQuote({ ...input, months: 0 }).laterMonths).toBe(0)
  })
  const arb = fc.record({
    monthlyRent: fc.integer({ min: 0, max: 50_000_000 }),
    applicationFee: fc.integer({ min: 0, max: 1_000_000 }),
    discountAmount: fc.integer({ min: 0, max: 100_000_000 }),
    campusEmailVerified: fc.boolean(),
    months: fc.integer({ min: 1, max: 12 }),
  })
  it('property: first payment matches checkout and later invoices carry rent only', () => {
    fc.assert(fc.property(arb, (i) => {
      const quote = leaseQuote(i)
      expect(quote.firstPayment).toBe(computeCheckoutTotal(i).total)
      expect(quote.leaseTotal).toBe(quote.firstPayment + quote.laterMonths * quote.rent)
    }))
  })
})
