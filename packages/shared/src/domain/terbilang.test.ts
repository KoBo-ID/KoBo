import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { terbilang } from './terbilang.ts'

describe('terbilang', () => {
  it.each([
    [0, 'Nol Rupiah'],
    [1, 'Satu Rupiah'],
    [11, 'Sebelas Rupiah'],
    [12, 'Dua Belas Rupiah'],
    [100, 'Seratus Rupiah'],
    [1000, 'Seribu Rupiah'],
    [1001, 'Seribu Satu Rupiah'],
    [1_250_000, 'Satu Juta Dua Ratus Lima Puluh Ribu Rupiah'],
    [2_000_000_000, 'Dua Miliar Rupiah'],
    [999_999_999_999, 'Sembilan Ratus Sembilan Puluh Sembilan Miliar Sembilan Ratus Sembilan Puluh Sembilan Juta Sembilan Ratus Sembilan Puluh Sembilan Ribu Sembilan Ratus Sembilan Puluh Sembilan Rupiah'],
  ])('%i', (n, words) => {
    expect(terbilang(n)).toBe(words)
  })
  it('always ends with " Rupiah" (property)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 999_999_999_999 }), (n) => terbilang(n).endsWith(' Rupiah')))
  })
  it('rejects non-integers, negatives and values above the range', () => {
    for (const n of [1.5, -1, 1_000_000_000_000, NaN, Infinity]) expect(() => terbilang(n)).toThrow(RangeError)
  })
})
