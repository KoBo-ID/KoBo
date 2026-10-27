import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isPhoneLike, isUrlLike, modeFor, motorMinutes, PLACE_CATEGORIES, placeCategory, rankPlaces, walkMinutes, type RankablePlace } from './places.ts'

const food = placeCategory('food')!
const p = (id: string, distanceM: number, extra: Partial<RankablePlace> = {}): RankablePlace => ({ id, name: `Tempat ${id}`, brand: null, score: 3, distanceM, ...extra })

describe('estimates', () => {
  it('walks 80 m/min and rides 400 m/min, at least one minute', () => {
    expect(walkMinutes(400)).toBe(5)
    expect(motorMinutes(2000)).toBe(5)
    expect(walkMinutes(0)).toBe(1)
  })

  it('campus switches to motor beyond 1.5 km, hospital is always motor, food always walk', () => {
    expect(modeFor('campus', 1200)).toBe('walk')
    expect(modeFor('campus', 1800)).toBe('motor')
    expect(modeFor('hospital', 100)).toBe('motor')
    expect(modeFor('food', 900)).toBe('walk')
  })

  it('every category has primary < more and a positive cap', () => {
    for (const c of PLACE_CATEGORIES) {
      expect(c.primaryRadius).toBeLessThan(c.moreRadius)
      expect(c.cap).toBeGreaterThan(0)
    }
  })
})

describe('rankPlaces', () => {
  it('drops unnamed places and those beyond the show-more radius', () => {
    const r = rankPlaces([p('a', 100), p('b', 200, { name: null }), p('c', 200, { name: '  ' }), p('far', 5000)], food)
    expect([...r.primary, ...r.more].map((x) => x.id)).toEqual(['a'])
  })

  it('puts places inside the primary radius first, the rest in show-more, each capped', () => {
    const near = Array.from({ length: 8 }, (_, i) => p(`n${i}`, 50 + i * 10))
    const mid = Array.from({ length: 8 }, (_, i) => p(`m${i}`, 600 + i * 10))
    const r = rankPlaces([...mid, ...near], food)
    expect(r.primary).toHaveLength(5)
    expect(r.primary.every((x) => x.distanceM <= 500)).toBe(true)
    expect(r.more).toHaveLength(5)
    expect(new Set([...r.primary, ...r.more].map((x) => x.id)).size).toBe(10)
  })

  it('allows at most two places per brand', () => {
    const r = rankPlaces([1, 2, 3, 4].map((i) => p(`b${i}`, 100 * i, { brand: 'Indomaret' })).concat([p('other', 350)]), placeCategory('minimarket')!)
    expect(r.primary.filter((x) => x.brand === 'Indomaret')).toHaveLength(2)
    expect(r.primary.map((x) => x.id)).toContain('other')
  })

  it('shows one copy of a business that two sources both list (same name, almost the same distance)', () => {
    const r = rankPlaces([p('osm1', 100, { name: 'Warung Bu Sri' }), p('ovt1', 120, { name: 'warung  bu sri!' }), p('other', 140, { name: 'Warung Bu Sri' }), p('far-same-name', 400, { name: 'Warung Bu Sri' })], food)
    expect(r.primary.map((x) => x.id)).toEqual(['osm1', 'far-same-name'])
  })

  it('lets a higher score beat a slightly nearer place', () => {
    const r = rankPlaces([p('near', 100, { score: 0 }), p('good', 110, { score: 6 })], food)
    expect(r.primary[0]!.id).toBe('good')
  })

  it('never returns more than 2 * cap and never repeats an id', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ d: fc.integer({ min: 0, max: 9000 }), s: fc.integer({ min: 0, max: 6 }), named: fc.boolean(), brand: fc.constantFrom(null, 'a', 'b') }), { maxLength: 80 }),
        (rows) => {
          const places = rows.map((x, i) => p(`p${i}`, x.d, { score: x.s, name: x.named ? 'x' : null, brand: x.brand }))
          const r = rankPlaces(places, food)
          const ids = [...r.primary, ...r.more].map((x) => x.id)
          expect(ids.length).toBeLessThanOrEqual(2 * food.cap)
          expect(new Set(ids).size).toBe(ids.length)
          expect(r.primary.every((x) => x.distanceM <= food.primaryRadius)).toBe(true)
        },
      ),
    )
  })
})

describe('owner text guards', () => {
  it('spots phone numbers however they are written', () => {
    for (const t of ['0812-3456-7890', '+62 812 3456 7890', 'hubungi 08123456789', '(021) 5551234', '62 812 3456 789']) expect(isPhoneLike(t)).toBe(true)
    for (const t of ['Warung Bu Sri', 'Lantai 3 no 12', 'buka jam 6 sampai 22']) expect(isPhoneLike(t)).toBe(false)
  })

  it('spots links and handles', () => {
    for (const t of ['https://wa.me/62812', 'www.toko.com', 'cek toko.id', 'ig @warungsri', 'wa.me/6281']) expect(isUrlLike(t)).toBe(true)
    for (const t of ['Warung Bu Sri', 'Toko Jaya, Jl. Merdeka no. 5', 'Kopi 24 jam']) expect(isUrlLike(t)).toBe(false)
  })
})
