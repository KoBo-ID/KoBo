import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { caller, callerFor, newStudent, prisma, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const startDate = () => addDays(todayWIB(new Date()), 7)
const inputFor = (roomId: string) => ({ roomId, startDate: startDate(), durationMonths: 6, occupation: 'Mahasiswa dan pekerja paruh waktu', note: 'Berencana tinggal sampai lulus.' })

async function ownerForRoom(room: Awaited<ReturnType<typeof vacantRoom>>) {
  const owner = await prisma.ownerProfile.findUniqueOrThrow({ where: { id: room.kos.ownerId }, select: { userId: true } })
  return callerFor(owner.userId)
}

describe('application.create and mine', () => {
  it('requires authentication', async () => {
    const room = await vacantRoom()
    expect((await err(caller.application.create(inputFor(room.id))))?.code).toBe('UNAUTHORIZED')
  })

  it('creates only a pending application and exposes it only to its renter', async () => {
    const room = await vacantRoom()
    const renter = await newStudent()
    const other = await newStudent()
    const before = await prisma.tenancy.count()

    const created = await callerFor(renter.id).application.create(inputFor(room.id))

    expect(created).toMatchObject({ status: 'PENDING' })
    expect(await prisma.tenancy.count()).toBe(before)
    expect(await callerFor(other.id).application.mine()).toEqual([])
    expect(await callerFor(renter.id).application.mine()).toEqual([
      expect.objectContaining({ id: created.id, status: 'PENDING', startDate: startDate(), durationMonths: 6, occupation: 'Mahasiswa dan pekerja paruh waktu', tenancyId: null }),
    ])
  })

  it('refuses duplicate pending applications and invalid dates', async () => {
    const room = await vacantRoom()
    const renter = callerFor((await newStudent()).id)
    await renter.application.create(inputFor(room.id))
    expect((await err(renter.application.create(inputFor(room.id))))?.code).toBe('CONFLICT')
    expect((await err(renter.application.create({ ...inputFor(room.id), startDate: addDays(todayWIB(new Date()), -1) })))?.code).toBe('BAD_REQUEST')
  })
})

describe('application owner decisions', () => {
  it('lists only applications for the owned kos', async () => {
    const room = await vacantRoom()
    const renter = await newStudent()
    const created = await callerFor(renter.id).application.create(inputFor(room.id))
    const owner = await ownerForRoom(room)

    expect(await owner.application.ownerList({ kosId: room.kosId })).toEqual([
      expect.objectContaining({ id: created.id, status: 'PENDING', applicant: expect.objectContaining({ name: renter.name }), room: expect.objectContaining({ id: room.id }) }),
    ])
    expect((await err(callerFor(renter.id).application.ownerList({ kosId: room.kosId })))?.code).toBe('FORBIDDEN')
  })

  it('rejects without creating a tenancy', async () => {
    const room = await vacantRoom()
    const renter = await newStudent()
    const created = await callerFor(renter.id).application.create(inputFor(room.id))
    const owner = await ownerForRoom(room)
    const before = await prisma.tenancy.count()

    const decided = await owner.application.decide({ kosId: room.kosId, applicationId: created.id, decision: 'REJECT' })

    expect(decided).toEqual({ id: created.id, status: 'REJECTED', tenancyId: null })
    expect(await prisma.tenancy.count()).toBe(before)
  })

  it('approves into a 24-hour payment hold with an immutable invoice and no payment attempt', async () => {
    const room = await vacantRoom()
    const winner = await newStudent()
    await prisma.user.update({ where: { id: winner.id }, data: { campusEmailVerifiedAt: new Date() } })
    const loser = await newStudent()
    const a = await callerFor(winner.id).application.create(inputFor(room.id))
    const b = await callerFor(loser.id).application.create({ ...inputFor(room.id), occupation: 'Karyawan' })
    const owner = await ownerForRoom(room)

    const decided = await owner.application.decide({ kosId: room.kosId, applicationId: a.id, decision: 'APPROVE' })

    expect(decided.status).toBe('APPROVED')
    expect(decided.tenancyId).toBeTruthy()
    const tenancy = await prisma.tenancy.findUniqueOrThrow({ where: { id: decided.tenancyId! }, include: { invoices: { include: { payments: true } } } })
    expect(tenancy).toMatchObject({ roomId: room.id, userId: winner.id, status: 'PENDING', durationMonths: 6 })
    expect(tenancy.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000)
    expect(tenancy.invoices).toHaveLength(1)
    const discount = Math.min(room.kos.studentDiscountAmount, room.priceMonthly + room.kos.applicationFee)
    expect(tenancy.invoices[0]).toMatchObject({
      rentAmount: room.priceMonthly,
      discountAmount: discount,
      applicationFeeAmount: room.kos.applicationFee,
      ownerReceivableAmount: room.priceMonthly - discount,
      amount: room.priceMonthly + room.kos.applicationFee - discount,
      gatewayFeeBearer: 'PLATFORM',
      status: 'UNPAID',
      payments: [],
    })
    expect((await callerFor(loser.id).application.mine()).find((x) => x.id === b.id)?.status).toBe('REJECTED')
  })

  it('refuses a second decision', async () => {
    const room = await vacantRoom()
    const created = await callerFor((await newStudent()).id).application.create(inputFor(room.id))
    const owner = await ownerForRoom(room)
    await owner.application.decide({ kosId: room.kosId, applicationId: created.id, decision: 'REJECT' })
    expect((await err(owner.application.decide({ kosId: room.kosId, applicationId: created.id, decision: 'APPROVE' })))?.code).toBe('CONFLICT')
  })
})
