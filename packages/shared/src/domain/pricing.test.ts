import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { clampDiscount, computeCheckoutTotal, leaseQuote, MIN_FIRST_INVOICE } from './pricing.ts'

describe('computeCheckoutTotal', () => {
  it('applies discount when verified', () => {
    expect(
      computeCheckoutTotal({ monthlyRent: 1_000_000, applicationFee: 50_000, discountAmount: 100_000, discountEligible: true }),
    ).toEqual({ rent: 1_000_000, applicationFee: 50_000, discount: 100_000, total: 950_000 })
  })
  it('ignores discount when unverified', () => {
    expect(
      computeCheckoutTotal({ monthlyRent: 1_000_000, applicationFee: 50_000, discountAmount: 100_000, discountEligible: false }).total,
    ).toBe(1_050_000)
  })
  it('clamps discount so invoice #1 never falls below MIN_FIRST_INVOICE (FL-11)', () => {
    expect(computeCheckoutTotal({ monthlyRent: 500_000, applicationFee: 0, discountAmount: 500_000, discountEligible: true })).toEqual({
      rent: 500_000,
      applicationFee: 0,
      discount: 490_000,
      total: MIN_FIRST_INVOICE,
    })
    expect(clampDiscount(500_000, 0, 500_000)).toBe(490_000)
    // When gross is already below MIN_FIRST_INVOICE, discount clamps to 0 so total stays gross.
    expect(computeCheckoutTotal({ monthlyRent: 100, applicationFee: 0, discountAmount: 500, discountEligible: true })).toEqual({
      rent: 100,
      applicationFee: 0,
      discount: 0,
      total: 100,
    })
  })
  it('never discounts the application fee (invoice constraint: discount <= rent)', () => {
    expect(computeCheckoutTotal({ monthlyRent: 1_550_000, applicationFee: 25_000, discountAmount: 1_600_000, discountEligible: true })).toEqual({
      rent: 1_550_000,
      applicationFee: 25_000,
      discount: 1_550_000,
      total: 25_000,
    })
  })

  const arb = fc.record({
    monthlyRent: fc.integer({ min: 0, max: 50_000_000 }),
    applicationFee: fc.integer({ min: 0, max: 1_000_000 }),
    discountAmount: fc.integer({ min: 0, max: 100_000_000 }),
    discountEligible: fc.boolean(),
  })
  it('property: total >= min(gross, MIN_FIRST_INVOICE), integer, total = rent + fee - discount', () => {
    fc.assert(
      fc.property(arb, (i) => {
        const r = computeCheckoutTotal(i)
        const gross = r.rent + r.applicationFee
        expect(r.total).toBeGreaterThanOrEqual(Math.min(gross, MIN_FIRST_INVOICE))
        expect(Number.isInteger(r.total)).toBe(true)
        expect(r.total).toBe(gross - r.discount)
        expect(r.discount).toBeLessThanOrEqual(i.discountAmount)
        expect(r.discount).toBeLessThanOrEqual(r.rent)
      }),
    )
  })
  it('property: unverified implies discount 0', () => {
    fc.assert(
      fc.property(arb, (i) => {
        expect(computeCheckoutTotal({ ...i, discountEligible: false }).discount).toBe(0)
      }),
    )
  })
})

describe('leaseQuote', () => {
  const input = { monthlyRent: 1_650_000, applicationFee: 25_000, discountAmount: 150_000, discountEligible: true, months: 3 }

  it('discounts only the first invoice for a verified student', () => {
    expect(leaseQuote(input)).toEqual({ rent: 1_650_000, applicationFee: 25_000, discount: 150_000, firstPayment: 1_525_000, laterMonths: 2, laterTotal: 3_300_000, leaseTotal: 4_825_000 })
  })
  it('does not discount an unverified student', () => {
    expect(leaseQuote({ ...input, discountEligible: false })).toMatchObject({ firstPayment: 1_675_000, discount: 0, leaseTotal: 4_975_000 })
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
    discountEligible: fc.boolean(),
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
