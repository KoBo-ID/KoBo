/** Shown wherever the campus discount is named. */
export const DISCOUNT_LABEL = 'Diskon Kampus Mitra'

/** Invoice #1 is never below this (or below rent + fee when that is smaller): Rp 0 cannot be paid online or recorded by the owner. */
export const MIN_FIRST_INVOICE = 10_000

/**
 * G2-02 / FL-11: a student discount at or above the rent would leave invoice #1 at Rp 0 (when applicationFee is 0).
 * Cap the discount so invoice #1 stays payable (>= min(rent + fee, MIN_FIRST_INVOICE)), and never exceeds rent.
 */
export function clampDiscount(rent: number, applicationFee: number, discount: number): number {
  const safeRent = Math.max(0, Math.trunc(rent))
  const safeFee = Math.max(0, Math.trunc(applicationFee))
  const safeDiscount = Math.max(0, Math.trunc(discount))
  const gross = safeRent + safeFee
  const maxByFloor = Math.max(0, gross - Math.min(gross, MIN_FIRST_INVOICE))
  return Math.min(safeDiscount, safeRent, maxByFloor)
}

export interface CheckoutInput {
  monthlyRent: number
  applicationFee: number
  discountAmount: number
  discountEligible: boolean
}

export interface CheckoutTotal {
  rent: number
  applicationFee: number
  discount: number
  total: number
}

/**
 * Integer rupiah. Discount applies only when eligible, is capped at monthly rent (the application fee is never
 * discounted), and clamped via `clampDiscount` so invoice #1 never drops below min(rent + fee, MIN_FIRST_INVOICE).
 */
export function computeCheckoutTotal(input: CheckoutInput): CheckoutTotal {
  const rent = Math.max(0, Math.trunc(input.monthlyRent))
  const applicationFee = Math.max(0, Math.trunc(input.applicationFee))
  const gross = rent + applicationFee
  const requested = input.discountEligible ? Math.max(0, Math.trunc(input.discountAmount)) : 0
  const discount = clampDiscount(rent, applicationFee, requested)
  return { rent, applicationFee, discount, total: gross - discount }
}

/** Longest lease bookable in one checkout. */
export const MAX_LEASE_MONTHS = 12

export interface LeaseQuoteInput extends CheckoutInput {
  months: number
}

export interface LeaseQuote {
  rent: number
  applicationFee: number
  discount: number
  /** Invoice #1. Always equals computeCheckoutTotal(...).total. */
  firstPayment: number
  /** Months after the first; invoices #2..N carry rent only (no discount, no fee). */
  laterMonths: number
  laterTotal: number
  leaseTotal: number
}

/** What a lease costs across its invoices. Months are clamped to 1..MAX_LEASE_MONTHS. */
export function leaseQuote(input: LeaseQuoteInput): LeaseQuote {
  const first = computeCheckoutTotal(input)
  const months = Math.min(MAX_LEASE_MONTHS, Math.max(1, Math.trunc(input.months)))
  const laterMonths = months - 1
  const laterTotal = laterMonths * first.rent
  return {
    rent: first.rent,
    applicationFee: first.applicationFee,
    discount: first.discount,
    firstPayment: first.total,
    laterMonths,
    laterTotal,
    leaseTotal: first.total + laterTotal,
  }
}
