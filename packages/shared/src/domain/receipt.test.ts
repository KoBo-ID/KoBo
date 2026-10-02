import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { formatReceiptNo } from './receipt.ts'

describe('formatReceiptNo', () => {
  it('pads to 4 digits', () => {
    expect(formatReceiptNo(7, new Date('2026-10-15T05:00:00Z'))).toBe('KB/2026/10/0007')
  })
  it('does not truncate wide numbers', () => {
    expect(formatReceiptNo(123456, new Date('2026-10-15T05:00:00Z'))).toBe('KB/2026/10/123456')
  })
  it('uses WIB month and year', () => {
    expect(formatReceiptNo(1, new Date('2026-10-31T17:00:00Z'))).toBe('KB/2026/11/0001')
    expect(formatReceiptNo(1, new Date('2026-10-31T16:59:59Z'))).toBe('KB/2026/10/0001')
    expect(formatReceiptNo(1, new Date('2026-12-31T17:00:00Z'))).toBe('KB/2027/01/0001')
  })
  it('property: shape and number round-trip', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99_999_999 }),
        fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }),
        (n, d) => {
          const s = formatReceiptNo(n, d)
          expect(s).toMatch(/^KB\/\d{4}\/(0[1-9]|1[0-2])\/\d{4,}$/)
          expect(Number(s.split('/')[3])).toBe(n)
        },
      ),
    )
  })
})
