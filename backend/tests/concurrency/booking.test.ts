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
  const apply = (userId: string, roomId: string) => callerFor(userId).application.create({ roomId, startDate: startDate(), durationMonths: 6, occupation: 'Mahasiswa' })
  const ownerFor = async (room: Awaited<ReturnType<typeof vacantRoom>>) => {
    const owner = await prisma.ownerProfile.findUniqueOrThrow({ where: { id: room.kos.ownerId }, select: { userId: true } })
    return callerFor(owner.userId)
  }

  it('two simultaneous approvals for one room: exactly one wins', async () => {
    for (let round = 0; round < 3; round++) {
      const room = await vacantRoom(round)
      const applications = await Promise.all([apply(DEMO_STUDENT_ID, room.id), apply('user-student-1', room.id)])
      const owner = await ownerFor(room)
      const results = await Promise.all([
        settle(owner.application.decide({ kosId: room.kosId, applicationId: applications[0].id, decision: 'APPROVE' })),
        settle(owner.application.decide({ kosId: room.kosId, applicationId: applications[1].id, decision: 'APPROVE' })),
      ])
      const losers = results.filter((r) => r !== null)
      expect(losers).toHaveLength(1)
      expect(losers[0]!.code).toBe('CONFLICT')
      expect(await prisma.tenancy.count({ where: { roomId: room.id, status: { in: ['PENDING', 'ACTIVE'] } } })).toBe(1)
      expect(await prisma.invoice.count({ where: { tenancy: { roomId: room.id } } })).toBe(1)
    }
  })

  it('many simultaneous approvals still produce one winner', async () => {
    const room = await vacantRoom()
    const applications = await Promise.all([1, 2, 3, 4, 5].map((i) => apply(`user-student-${i}`, room.id)))
    const owner = await ownerFor(room)
    const results = await Promise.all(applications.map((application) => settle(owner.application.decide({ kosId: room.kosId, applicationId: application.id, decision: 'APPROVE' }))))
    expect(results.filter((r) => r === null)).toHaveLength(1)
    expect(results.filter((r) => r?.code === 'CONFLICT')).toHaveLength(4)
  })

  it('an expired PENDING hold no longer blocks a new booking', async () => {
    const room = await vacantRoom()
    await prisma.tenancy.create({
      data: { roomId: room.id, userId: 'user-student-2', status: 'PENDING', startDate: new Date(), durationMonths: 6, expiresAt: new Date(Date.now() - 1000) },
    })
    const application = await apply(DEMO_STUDENT_ID, room.id)
    const res = await (await ownerFor(room)).application.decide({ kosId: room.kosId, applicationId: application.id, decision: 'APPROVE' })
    expect(res.tenancyId).toBeTruthy()
  })
})
