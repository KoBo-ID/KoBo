import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, DEMO_STUDENT_ID, prisma, vacantRoom } from '../helpers.ts'

// Real commits (no per-test rollback): transactions race for one room and the partial unique index decides.
beforeEach(() => resetDb(prisma))

const settle = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as TRPCError)
const startDate = () => addDays(todayWIB(new Date()), 3)

describe('booking race', () => {
  it('two simultaneous bookings of one room: exactly one wins, the other gets CONFLICT', async () => {
    for (let round = 0; round < 3; round++) {
      const room = await vacantRoom(round)
      const input = { roomId: room.id, startDate: startDate(), durationMonths: 6 }
      const results = await Promise.all([
        settle(callerFor(DEMO_STUDENT_ID).booking.create(input)),
        settle(callerFor('user-student-1').booking.create(input)),
      ])
      const losers = results.filter((r) => r !== null)
      expect(losers).toHaveLength(1)
      expect(losers[0]!.code).toBe('CONFLICT')
      expect(losers[0]!.message).toBe('Kamar baru saja dibooking orang lain.')
      expect(await prisma.tenancy.count({ where: { roomId: room.id, status: { in: ['PENDING', 'ACTIVE'] } } })).toBe(1)
      expect(await prisma.invoice.count({ where: { tenancy: { roomId: room.id } } })).toBe(1)
    }
  })

  it('many simultaneous bookings still produce one winner', async () => {
    const room = await vacantRoom()
    const input = { roomId: room.id, startDate: startDate(), durationMonths: 6 }
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => settle(callerFor(`user-student-${i}`).booking.create(input))))
    expect(results.filter((r) => r === null)).toHaveLength(1)
    expect(results.filter((r) => r?.code === 'CONFLICT')).toHaveLength(4)
  })

  it('an expired PENDING hold no longer blocks a new booking', async () => {
    const room = await vacantRoom()
    await prisma.tenancy.create({
      data: { roomId: room.id, userId: 'user-student-2', status: 'PENDING', startDate: new Date(), durationMonths: 6, expiresAt: new Date(Date.now() - 1000) },
    })
    const res = await callerFor(DEMO_STUDENT_ID).booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 6 })
    expect(res.tenancyId).toBeTruthy()
  })
})
