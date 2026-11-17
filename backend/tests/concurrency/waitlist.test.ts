import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { advanceAllWaitlists } from '../../src/waitlist.ts'
import { newStudent, prisma } from '../helpers.ts'

// Real commits: parallel ticks race for the same kos and the kos row lock plus the partial unique indexes decide.
beforeEach(() => resetDb(prisma))

describe('advanceAllWaitlists race', () => {
  it('two parallel runs produce exactly one offer per room and one per entry', async () => {
    const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { user: { isDemo: false } }, orderBy: { id: 'asc' } })
    const kos = await prisma.kos.create({
      data: {
        slug: 'antre-balapan',
        name: 'Kos Antre Balapan',
        gender: 'CAMPUR',
        address: 'Jl. Antre',
        district: 'Kebayoran',
        city: 'Jakarta',
        lat: -6.2,
        lng: 106.8,
        electricityType: 'INCLUDED',
        ownerId: owner.id,
        rooms: { create: ['101', '102', '103'].map((n) => ({ roomNumber: n, floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 1_500_000 })) },
      },
      include: { rooms: true },
    })
    // Fill the kos, queue five students, then free all rooms behind the engine's back so only the ticks can offer them.
    const tenants = await newStudent()
    const tenancies = await Promise.all(kos.rooms.map((r) => prisma.tenancy.create({ data: { roomId: r.id, userId: tenants.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 } })))
    for (let i = 0; i < 5; i++) {
      const s = await newStudent()
      await prisma.waitlistEntry.create({ data: { kosId: kos.id, userId: s.id, createdAt: new Date(Date.now() + i) } })
    }
    await prisma.tenancy.updateMany({ where: { id: { in: tenancies.map((t) => t.id) } }, data: { status: 'ENDED', endedAt: new Date() } })

    const results = await Promise.allSettled([advanceAllWaitlists(prisma), advanceAllWaitlists(prisma), advanceAllWaitlists(prisma)])
    expect(results.filter((r) => r.status === 'rejected')).toEqual([])

    const offered = await prisma.waitlistEntry.findMany({ where: { kosId: kos.id, status: 'OFFERED' }, orderBy: { createdAt: 'asc' } })
    expect(offered).toHaveLength(3)
    expect(new Set(offered.map((o) => o.offeredRoomId)).size).toBe(3)
    expect(new Set(offered.map((o) => o.userId)).size).toBe(3)
    // FIFO: the first three entries won.
    const waiting = await prisma.waitlistEntry.findMany({ where: { kosId: kos.id, status: 'WAITING' } })
    expect(waiting).toHaveLength(2)
    expect(Math.min(...waiting.map((w) => w.createdAt.getTime()))).toBeGreaterThan(Math.max(...offered.map((o) => o.createdAt.getTime())))
    // One email per offer, never a duplicate.
    expect(await prisma.emailOutbox.count({ where: { template: 'waitlist-offer' } })).toBe(3)
  })
})
