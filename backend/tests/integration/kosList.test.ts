import { beforeEach, describe, expect, it } from 'vitest'
import seedData from '../../src/db/seedData.json' with { type: 'json' }
import { resetDb } from '../../src/db/seed.ts'
import { caller, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

/** Independent re-derivation of the aggregates straight from rows, to check the SQL. */
async function expectedAggregates(kosId: string) {
  const rooms = await prisma.room.findMany({ where: { kosId }, include: { tenancies: true } })
  const reviews = await prisma.review.findMany({ where: { tenancy: { room: { kosId } } } })
  const now = Date.now()
  const live = (t: { status: string; expiresAt: Date | null }) =>
    t.status === 'ACTIVE' || (t.status === 'PENDING' && t.expiresAt !== null && t.expiresAt.getTime() > now)
  return {
    totalRooms: rooms.length,
    availableRooms: rooms.filter((r) => !r.tenancies.some(live)).length,
    priceMonthlyStart: rooms.length ? Math.min(...rooms.map((r) => r.priceMonthly)) : null,
    reviewCount: reviews.length,
    rating: reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : null,
  }
}

describe('kos.list', () => {
  it('returns every seeded kos with card fields', async () => {
    const list = await caller.kos.list()
    expect(list.map((k) => k.id)).toEqual(seedData.kos.map((k) => k.id))
    const first = list[0]
    expect(first.images.length).toBeGreaterThan(0)
    expect(first.images[0]).toMatch(/^https:\/\/images\.unsplash\.com\//)
    expect(first.nearestCampusId).toBeTruthy()
  })

  it('computes rating, reviewCount, price and room counts from the underlying rows', async () => {
    const list = await caller.kos.list()
    for (const card of list) {
      const exp = await expectedAggregates(card.id)
      expect({
        totalRooms: card.totalRooms,
        availableRooms: card.availableRooms,
        priceMonthlyStart: card.priceMonthlyStart,
        reviewCount: card.reviewCount,
        rating: card.rating,
      }).toEqual(exp)
    }
  })

  it('seed filler makes computed numbers match the mock card numbers', async () => {
    const list = await caller.kos.list()
    for (const mock of seedData.kos) {
      const card = list.find((k) => k.id === mock.id)!
      expect(card.totalRooms).toBe(mock.totalRooms)
      expect(card.availableRooms).toBe(mock.availableRooms)
      expect(card.reviewCount).toBe(mock.reviewCount)
      expect(Math.abs(card.rating! - mock.rating)).toBeLessThanOrEqual(0.15)
    }
  })

  it('honours the limit input', async () => {
    expect(await caller.kos.list({ limit: 2 })).toHaveLength(2)
    await expect(caller.kos.list({ limit: 0 })).rejects.toThrow()
  })

  it('treats a PENDING hold as unavailable only until it expires', async () => {
    const before = await caller.kos.list()
    const target = before.find((k) => k.availableRooms > 0)!
    const room = await prisma.room.findFirstOrThrow({
      where: { kosId: target.id, tenancies: { none: { status: { in: ['PENDING', 'ACTIVE'] } } } },
    })
    const user = await prisma.user.findFirstOrThrow()
    const hold = await prisma.tenancy.create({
      data: { roomId: room.id, userId: user.id, status: 'PENDING', startDate: new Date(), durationMonths: 6, expiresAt: new Date(Date.now() + 3600_000) },
    })
    expect((await caller.kos.list()).find((k) => k.id === target.id)!.availableRooms).toBe(target.availableRooms - 1)
    await prisma.tenancy.update({ where: { id: hold.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await caller.kos.list()).find((k) => k.id === target.id)!.availableRooms).toBe(target.availableRooms)
  })
})
