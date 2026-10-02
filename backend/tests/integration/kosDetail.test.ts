import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { caller, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code
const firstKosId = async () => (await prisma.kos.findFirstOrThrow({ orderBy: { createdAt: 'asc' } })).id

describe('kos.detail', () => {
  it('returns NOT_FOUND for an unknown id', async () => {
    expect(await code(caller.kos.detail({ id: 'nope' }))).toBe('NOT_FOUND')
  })

  it('returns everything the Detail page renders', async () => {
    const id = await firstKosId()
    const d = await caller.kos.detail({ id })
    const [kos, rooms, rules, pois, images] = await Promise.all([
      prisma.kos.findUniqueOrThrow({ where: { id }, include: { owner: { include: { user: true } }, nearestCampus: true } }),
      prisma.room.count({ where: { kosId: id } }),
      prisma.houseRule.count({ where: { kosId: id } }),
      prisma.poi.count({ where: { kosId: id } }),
      prisma.kosImage.findMany({ where: { kosId: id }, orderBy: { order: 'asc' } }),
    ])
    expect(d).toMatchObject({
      id,
      name: kos.name,
      address: kos.address,
      gender: kos.gender,
      studentDiscountAmount: kos.studentDiscountAmount,
      applicationFee: kos.applicationFee,
      electricityType: kos.electricityType,
      privateAmenities: kos.privateAmenities,
      sharedAmenities: kos.sharedAmenities,
      images: images.map((i) => i.url),
    })
    expect(d.nearestCampus).toEqual({ id: kos.nearestCampusId, shortName: kos.nearestCampus!.shortName })
    expect(d.rooms).toHaveLength(rooms)
    expect(d.rules).toHaveLength(rules)
    expect(d.pois).toHaveLength(pois)
    expect(d.totalRooms).toBe(rooms)
    expect(d.owner).toMatchObject({
      id: kos.ownerId,
      name: kos.owner.user.name,
      avatar: kos.owner.user.image,
      phone: kos.owner.user.phone,
      responseRate: kos.owner.responseRate,
      verified: kos.owner.verified,
    })
    expect(d.owner.totalProperties).toBe(await prisma.kos.count({ where: { ownerId: kos.ownerId } }))
    expect(new Date(d.owner.memberSince).toString()).not.toBe('Invalid Date')
  })

  it('computes rating, review count and sub-ratings from reviews, with reviewer details', async () => {
    const id = await firstKosId()
    const d = await caller.kos.detail({ id })
    const rows = await prisma.review.findMany({
      where: { tenancy: { room: { kosId: id } } },
      include: { tenancy: { include: { user: true } } },
    })
    expect(d.reviewCount).toBe(rows.length)
    const mean = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null)
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null
    }
    expect(d.rating).toBe(mean(rows.map((r) => r.rating)))
    expect(d.subRatings).toEqual({
      cleanliness: mean(rows.map((r) => r.cleanliness)),
      wifi: mean(rows.map((r) => r.wifi)),
      owner: mean(rows.map((r) => r.ownerRating)),
      quietness: mean(rows.map((r) => r.quietness)),
    })
    expect(d.reviews.length).toBe(Math.min(rows.length, 50))
    const stamps = d.reviews.map((r) => r.createdAt)
    expect(stamps).toEqual([...stamps].sort().reverse())
    const first = d.reviews[0]
    const row = rows.find((r) => r.id === first.id)!
    expect(first).toMatchObject({
      rating: row.rating,
      comment: row.comment,
      authorName: row.tenancy.user.name,
      authorCampus: row.tenancy.user.campus,
      verified: true,
    })
  })

  it('has null sub-ratings and rating for a kos without reviews', async () => {
    const id = await firstKosId()
    await prisma.review.deleteMany({ where: { tenancy: { room: { kosId: id } } } })
    const d = await caller.kos.detail({ id })
    expect(d.rating).toBeNull()
    expect(d.reviews).toEqual([])
    expect(d.subRatings).toEqual({ cleanliness: null, wifi: null, owner: null, quietness: null })
  })

  it('derives room status via deriveRoomStatus and never exposes tenants', async () => {
    const id = await firstKosId()
    const d = await caller.kos.detail({ id })
    expect(d.rooms.filter((r) => r.status === 'vacant')).toHaveLength(d.availableRooms)
    for (const r of d.rooms) {
      expect(Object.keys(r).sort()).toEqual(['bedType', 'floor', 'id', 'offeredToMe', 'priceMonthly', 'reservedForWaitlist', 'roomNumber', 'size', 'status', 'type'])
    }
    const order = d.rooms.map((r) => `${String(r.floor).padStart(3, '0')}|${r.roomNumber}`)
    expect(order).toEqual([...order].sort())
  })

  it('reads an unpaid invoice past its due date as overdue, and an expired hold as vacant', async () => {
    const id = await firstKosId()
    const vacant = await prisma.room.findMany({
      where: { kosId: id, tenancies: { none: { status: { in: ['ACTIVE', 'PENDING'] } } } },
      take: 2,
    })
    const user = await prisma.user.findFirstOrThrow()
    const today = todayWIB(new Date())
    const t = await prisma.tenancy.create({
      data: { roomId: vacant[0].id, userId: user.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 },
    })
    await prisma.invoice.create({
      data: {
        tenancyId: t.id,
        periodStart: new Date(`${addDays(today, -40)}T00:00:00Z`),
        dueDate: new Date(`${addDays(today, -10)}T00:00:00Z`),
        amount: 1,
        status: 'UNPAID',
      },
    })
    await prisma.tenancy.create({
      data: { roomId: vacant[1].id, userId: user.id, status: 'PENDING', startDate: new Date(), durationMonths: 6, expiresAt: new Date(Date.now() - 60_000) },
    })
    const d = await caller.kos.detail({ id })
    expect(d.rooms.find((r) => r.id === vacant[0].id)!.status).toBe('overdue')
    expect(d.rooms.find((r) => r.id === vacant[1].id)!.status).toBe('vacant')
  })
})
