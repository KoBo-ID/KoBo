import { haversineMeters } from '@kobo/shared/domain'
import { PRICE_MAX, SEARCH_LIMIT } from '@kobo/shared/search'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { caller, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const KEMANGGISAN = { lat: -6.1993, lng: 106.7878 }
const BANDUNG = { lat: -6.8908, lng: 107.6127 }

describe('kos.search', () => {
  it('with no filters returns every kos from the same card query as kos.list', async () => {
    const [all, list] = await Promise.all([caller.kos.search({}), caller.kos.list()])
    expect(all.map((k) => k.id).sort()).toEqual(list.map((k) => k.id).sort())
    const first = list[0]
    const { distanceMeters, ...rest } = all.find((k) => k.id === first.id)!
    expect(distanceMeters).toBeNull()
    expect(rest).toEqual(first)
  })

  it('sorts by rating (best first, unrated last) by default', async () => {
    const k = await prisma.kos.findFirstOrThrow()
    await prisma.review.deleteMany({ where: { tenancy: { room: { kosId: k.id } } } })
    const res = await caller.kos.search({})
    const ratings = res.map((r) => r.rating ?? -1)
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a))
    expect(res.find((r) => r.id === k.id)!.rating).toBeNull()
    expect(res.at(-1)!.rating).toBeNull()
  })

  it('sorts by cheapest price', async () => {
    const res = await caller.kos.search({ sort: 'price_asc' })
    const prices = res.map((r) => r.priceMonthlyStart ?? Infinity)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })

  it('sorts by distance to the reference point, nearest first', async () => {
    const res = await caller.kos.search({ sort: 'distance_asc', ...KEMANGGISAN })
    expect(res.length).toBeGreaterThan(1)
    const d = res.map((r) => r.distanceMeters!)
    expect(d).toEqual([...d].sort((a, b) => a - b))
  })

  it('without a reference point, distance sort falls back to the nearest campus', async () => {
    const res = await caller.kos.search({ sort: 'distance_asc' })
    const d = res.map((r) => r.nearestCampusMeters ?? Infinity)
    expect(d).toEqual([...d].sort((a, b) => a - b))
  })

  it('SQL haversine agrees with @kobo/shared haversineMeters within 1 m', async () => {
    for (const point of [KEMANGGISAN, BANDUNG]) {
      const res = await caller.kos.search({ ...point })
      expect(res.length).toBeGreaterThan(0)
      for (const k of res) {
        expect(Math.abs(k.distanceMeters! - haversineMeters(point, { lat: k.lat, lng: k.lng }))).toBeLessThanOrEqual(1)
      }
    }
  })

  it('restricts to 5 km around the reference point', async () => {
    const near = await caller.kos.search(KEMANGGISAN)
    expect(near.length).toBeGreaterThan(0)
    for (const k of near) expect(k.distanceMeters!).toBeLessThanOrEqual(5000)
    const all = await caller.kos.search({})
    expect(near.length).toBeLessThan(all.length) // the Depok / Bandung kos fall outside
    const far = await caller.kos.search(BANDUNG)
    expect(far.every((k) => k.city === 'Bandung')).toBe(true)
    expect(await caller.kos.search({ lat: 0, lng: 0 })).toEqual([])
  })

  it('filters by gender', async () => {
    const all = await caller.kos.search({})
    for (const gender of ['campur', 'putra', 'putri'] as const) {
      const res = await caller.kos.search({ gender })
      const expected = all.filter((k) => k.gender === gender.toUpperCase()).map((k) => k.id)
      expect(res.map((k) => k.id).sort()).toEqual(expected.sort())
    }
  })

  it('maxPrice filters on the cheapest-room price, but PRICE_MAX means no filter', async () => {
    const all = await caller.kos.search({})
    const prices = all.map((k) => k.priceMonthlyStart!).sort((a, b) => a - b)
    const cap = prices[1]
    const res = await caller.kos.search({ maxPrice: cap })
    expect(res.every((k) => k.priceMonthlyStart! <= cap)).toBe(true)
    expect(res.length).toBe(all.filter((k) => k.priceMonthlyStart! <= cap).length)

    // A kos above the slider range must still show at the default.
    const target = all[0]
    await prisma.room.updateMany({ where: { kosId: target.id }, data: { priceMonthly: PRICE_MAX + 500_000 } })
    expect((await caller.kos.search({})).map((k) => k.id)).toContain(target.id)
    expect((await caller.kos.search({ maxPrice: PRICE_MAX })).map((k) => k.id)).toContain(target.id)
    expect((await caller.kos.search({ maxPrice: PRICE_MAX - 100_000 })).map((k) => k.id)).not.toContain(target.id)
  })

  it('discountOnly keeps kos with a student discount', async () => {
    const all = await caller.kos.search({})
    const res = await caller.kos.search({ discountOnly: true })
    expect(res.length).toBe(all.filter((k) => k.studentDiscountAmount > 0).length)
    expect(res.every((k) => k.studentDiscountAmount > 0)).toBe(true)
  })

  it('surveyOnly keeps kos with a vacant room', async () => {
    const all = await caller.kos.search({})
    const full = all.find((k) => k.availableRooms > 0)!
    const user = await prisma.user.findFirstOrThrow()
    const vacant = await prisma.room.findMany({
      where: { kosId: full.id, tenancies: { none: { status: { in: ['ACTIVE', 'PENDING'] } } } },
    })
    await prisma.tenancy.createMany({
      data: vacant.map((r) => ({ roomId: r.id, userId: user.id, status: 'ACTIVE' as const, startDate: new Date(), durationMonths: 6 })),
    })
    const res = await caller.kos.search({ surveyOnly: true })
    expect(res.every((k) => k.availableRooms > 0)).toBe(true)
    expect(res.map((k) => k.id)).not.toContain(full.id)
    expect(res.length).toBe(all.filter((k) => k.id !== full.id && k.availableRooms > 0).length)
  })

  it('q matches name, district, address and amenities case-insensitively', async () => {
    const k = await prisma.kos.findFirstOrThrow({ orderBy: { createdAt: 'asc' } })
    const ids = async (q: string) => (await caller.kos.search({ q })).map((r) => r.id)
    expect(await ids(k.name.toUpperCase())).toContain(k.id)
    expect(await ids(k.district.toLowerCase())).toContain(k.id)
    expect(await ids(k.address.slice(4, 18))).toContain(k.id)
    expect(await ids(k.privateAmenities[0].toLowerCase())).toContain(k.id)
    expect(await ids(k.sharedAmenities[0])).toContain(k.id)
    expect(await ids('zzz-tidak-ada')).toEqual([])
  })

  it('treats LIKE wildcards in q literally', async () => {
    expect(await caller.kos.search({ q: '%' })).toEqual([])
    expect(await caller.kos.search({ q: '_' })).toEqual([])
  })

  it('combines filters with AND', async () => {
    const res = await caller.kos.search({ ...KEMANGGISAN, gender: 'campur', discountOnly: true, sort: 'price_asc' })
    for (const k of res) {
      expect(k.gender).toBe('CAMPUR')
      expect(k.studentDiscountAmount).toBeGreaterThan(0)
      expect(k.distanceMeters!).toBeLessThanOrEqual(5000)
    }
  })

  it('caps the result at SEARCH_LIMIT (200)', async () => {
    const src = await prisma.kos.findFirstOrThrow()
    const { id: _id, slug: _slug, createdAt: _c, updatedAt: _u, ...rest } = src
    await prisma.kos.createMany({
      data: Array.from({ length: SEARCH_LIMIT + 5 }, (_, i) => ({ ...rest, name: `Kos Massal ${i}`, slug: `kos-massal-${i}` })),
    })
    expect(await caller.kos.search({})).toHaveLength(SEARCH_LIMIT)
  })

  it('validates input', async () => {
    await expect(caller.kos.search({ lat: -6.2 })).rejects.toThrow()
    await expect(caller.kos.search({ lat: 120, lng: 0 })).rejects.toThrow()
    await expect(caller.kos.search({ sort: 'newest' as never })).rejects.toThrow()
  })
})
