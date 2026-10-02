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

/** Integer rupiah. Discount only when campus email verified, capped so total never goes negative. */
export function computeCheckoutTotal(input: CheckoutInput): CheckoutTotal {
  const rent = Math.max(0, Math.trunc(input.monthlyRent))
  const applicationFee = Math.max(0, Math.trunc(input.applicationFee))
  const gross = rent + applicationFee
  const requested = input.campusEmailVerified ? Math.max(0, Math.trunc(input.discountAmount)) : 0
  const discount = Math.min(requested, gross)
  return { rent, applicationFee, discount, total: gross - discount }
}

/** Longest lease bookable in one checkout. */
export const MAX_LEASE_MONTHS = 12
