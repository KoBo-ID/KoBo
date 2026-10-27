import { describe, expect, it } from 'vitest'
import { addressCandidates, cleanPart } from './addressQuery.ts'

describe('addressCandidates', () => {
  it('cleans admin words and numbering, then drops the most specific parts one by one', () => {
    const c = addressCandidates('Cluster Fluorite Blok FB No.27 Summarecon Serpong, Kelurahan Pakulonan Barat, Kecamatan Kelapa Dua, Tangerang')
    expect(c[0]).toEqual({ query: 'Cluster Fluorite Summarecon Serpong, Pakulonan Barat, Kelapa Dua, Tangerang', precision: 'exact' })
    expect(c.map((x) => x.query)).toContain('Pakulonan Barat, Kelapa Dua, Tangerang')
    expect(c.slice(1).every((x) => x.precision === 'area')).toBe(true)
  })

  it('handles RT/RW, postal codes and a single-part address', () => {
    expect(cleanPart('Jl. KH. Syahdan No. 28, RT 02/RW 11')).toBe('Jl. KH. Syahdan')
    expect(cleanPart('Kecamatan Palmerah 11480')).toBe('Palmerah')
    expect(addressCandidates('Jl. Melati 3')).toEqual([{ query: 'Jl. Melati 3', precision: 'exact' }])
  })

  it('never returns more than max candidates and no duplicates', () => {
    const c = addressCandidates('a, b, c, d, e, f, g', 3)
    expect(c).toHaveLength(3)
    expect(new Set(c.map((x) => x.query)).size).toBe(3)
  })

  it('returns nothing for empty input', () => {
    expect(addressCandidates('  , ')).toEqual([])
  })
})
