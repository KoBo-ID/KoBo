import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

async function freeRoom() {
  const room = await prisma.room.findFirstOrThrow({ where: { tenancies: { none: { status: { in: ['PENDING', 'ACTIVE'] } } } } })
  const user = await prisma.user.findFirstOrThrow({ where: { isDemo: true, ownerProfile: null } })
  return { room, user }
}
const tenancy = (roomId: string, userId: string, status: 'PENDING' | 'ACTIVE' | 'ENDED') =>
  prisma.tenancy.create({ data: { roomId, userId, status, startDate: new Date(), durationMonths: 6 } })

describe('resetDb', () => {
  it('truncates and reseeds in under 2 s, restarting identity', async () => {
    const t = performance.now()
    await resetDb(prisma)
    expect(performance.now() - t).toBeLessThan(2000)
    const first = await prisma.payment.findFirstOrThrow({ orderBy: { receiptNo: 'asc' } })
    expect(first.receiptNo).toBe(1)
  })

  it('is deterministic for a fixed clock', async () => {
    const now = new Date('2026-10-01T05:00:00Z')
    const snap = () => prisma.review.findMany({ orderBy: { id: 'asc' }, select: { id: true, rating: true, comment: true } })
    await resetDb(prisma, { now })
    const a = await snap()
    await resetDb(prisma, { now })
    expect(await snap()).toEqual(a)
  })

  it('seeds a verified demo student and a demo owner who owns the first kos', async () => {
    const student = await prisma.user.findUniqueOrThrow({ where: { email: 'demo-student@kobo.test' } })
    expect(student.isDemo).toBe(true)
    expect(student.campusEmailVerifiedAt).not.toBeNull()
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'demo-owner@kobo.test' },
      include: { ownerProfile: { include: { kos: { orderBy: { createdAt: 'asc' } } } } },
    })
    expect(owner.isDemo).toBe(true)
    expect(owner.ownerProfile!.kos[0].id).toBe('kos-1')
  })
})

describe('tenancy_one_active_per_room (partial unique index)', () => {
  it('rejects a second PENDING or ACTIVE tenancy on the same room', async () => {
    const { room, user } = await freeRoom()
    await tenancy(room.id, user.id, 'PENDING')
    await expect(tenancy(room.id, user.id, 'PENDING')).rejects.toThrow()
    await expect(tenancy(room.id, user.id, 'ACTIVE')).rejects.toThrow()
  })

  it('allows any number of ENDED tenancies beside one live one', async () => {
    const { room, user } = await freeRoom()
    await tenancy(room.id, user.id, 'ENDED')
    await tenancy(room.id, user.id, 'ENDED')
    await tenancy(room.id, user.id, 'ACTIVE')
  })
})

describe('CHECK constraints', () => {
  it('rejects negative money, out-of-range ratings and non-positive durations', async () => {
    const { room, user } = await freeRoom()
    await expect(prisma.room.update({ where: { id: room.id }, data: { priceMonthly: -1 } })).rejects.toThrow()
    await expect(
      prisma.tenancy.create({ data: { roomId: room.id, userId: user.id, status: 'ENDED', startDate: new Date(), durationMonths: 0 } }),
    ).rejects.toThrow()
    const ended = await tenancy(room.id, user.id, 'ENDED')
    await expect(prisma.review.create({ data: { tenancyId: ended.id, rating: 6, comment: 'x' } })).rejects.toThrow()
    await expect(prisma.review.create({ data: { tenancyId: ended.id, rating: 0, comment: 'x' } })).rejects.toThrow()
    await prisma.review.create({ data: { tenancyId: ended.id, rating: 5, comment: 'ok' } })
    await expect(prisma.review.create({ data: { tenancyId: ended.id, rating: 4, comment: 'twice' } })).rejects.toThrow()
  })
})
