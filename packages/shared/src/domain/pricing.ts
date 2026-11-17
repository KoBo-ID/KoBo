export interface CheckoutInput {
  monthlyRent: number
  applicationFee: number
  discountAmount: number
  campusEmailVerified: boolean
}

export interface CheckoutTotal {
  rent: number
  applicationFee: number
  discount: number
  total: number
}

/**
 * Integer rupiah. Discount only when campus email verified. It is capped at the monthly rent, not at rent + fee:
 * the invoice constraints require discountAmount <= rentAmount (the application fee is never discounted), so a
 * larger cap would produce an invoice the database refuses.
 */
export function computeCheckoutTotal(input: CheckoutInput): CheckoutTotal {
  const rent = Math.max(0, Math.trunc(input.monthlyRent))
  const applicationFee = Math.max(0, Math.trunc(input.applicationFee))
  const gross = rent + applicationFee
  const requested = input.campusEmailVerified ? Math.max(0, Math.trunc(input.discountAmount)) : 0
  const discount = Math.min(requested, rent)
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
