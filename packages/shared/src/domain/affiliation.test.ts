import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { isAffiliatedCampus } from './affiliation.ts'

const set = new Set(['binus-syahdan', 'binus'])

describe('isAffiliatedCampus', () => {
  it('is false without a campus', () => {
    expect(isAffiliatedCampus(null, set)).toBe(false)
  })
  it('is true on an id hit', () => {
    expect(isAffiliatedCampus({ id: 'binus-syahdan', parentId: null }, set)).toBe(true)
  })
  it('is true when only the parent is affiliated', () => {
    expect(isAffiliatedCampus({ id: 'branch-x', parentId: 'binus' }, set)).toBe(true)
  })
  it('is false on a miss, with or without a parent', () => {
    expect(isAffiliatedCampus({ id: 'ui-depok', parentId: null }, set)).toBe(false)
    expect(isAffiliatedCampus({ id: 'ui-x', parentId: 'ui' }, set)).toBe(false)
  })
  it('is false for any campus against an empty set (property)', () => {
    fc.assert(fc.property(fc.string(), fc.option(fc.string(), { nil: null }), (id, parentId) => !isAffiliatedCampus({ id, parentId }, new Set())))
  })
  it('is true whenever the id or parent is in the set (property)', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.boolean(), (id, other, viaParent) => {
        const campus = viaParent ? { id: other, parentId: id } : { id, parentId: null }
        return isAffiliatedCampus(campus, new Set([id]))
      }),
    )
  })
})
