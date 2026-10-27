import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { approveApplication, callerFor, cash, newStudent, prisma, vacantRoom } from '../helpers.ts'
import { joinQueue, kosInput, makeKos, newOwner, occupy, paidTenancy, roomInput, startIn } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

const settled = async (...ps: Promise<unknown>[]) => Promise.allSettled(ps)
const codeOf = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason as { code?: string }).code : 'OK')

describe('[G-032][R-029] two manual payments on one invoice', () => {
  it('records exactly one PAID MANUAL payment; the other call is refused', async () => {
    const room = await vacantRoom()
    const a = await approveApplication((await newStudent()).id, room.id)
    const owner = await prisma.ownerProfile.findUniqueOrThrow({ where: { id: a.room.kos.ownerId } })
    const c = callerFor(owner.userId)
    const input = await cash(a.room.kosId, a.invoiceId)

    const out = await settled(c.payment.recordManual(input), c.payment.recordManual(input))

    expect(out.map(codeOf).sort()).toEqual(['CONFLICT', 'OK'])
    const payments = await prisma.payment.findMany({ where: { invoiceId: a.invoiceId, provider: 'MANUAL' } })
    expect(payments).toHaveLength(1)
    expect(payments[0]!.status).toBe('PAID')
    expect(new Set(payments.map((p) => p.receiptNo)).size).toBe(1)
  })
})

describe('[G-033][R-015] a double-submitted application', () => {
  it('creates exactly one PENDING application; the duplicate is a CONFLICT, not a server error', async () => {
    const room = await vacantRoom()
    const renter = callerFor((await newStudent()).id)
    const input = { roomId: room.id, startDate: startIn(5), durationMonths: 3, occupation: 'Mahasiswa' }

    const out = await settled(renter.application.create(input), renter.application.create(input))

    expect(out.map(codeOf).sort()).toEqual(['CONFLICT', 'OK'])
    expect(await prisma.rentalApplication.count({ where: { roomId: room.id, status: 'PENDING' } })).toBe(1)
  })
})

describe('[G-034][R-063] a double-clicked waitlist join', () => {
  it('leaves exactly one live entry', async () => {
    const k = await makeKos([{ n: 'W1', type: 'Standar' }])
    await occupy(k.room('W1').id)
    const s = await newStudent()
    const c = callerFor(s.id)

    const out = await settled(c.waitlist.join({ kosId: k.kos.id, roomType: null }), c.waitlist.join({ kosId: k.kos.id, roomType: null }))

    expect(out.map(codeOf).sort()).toEqual(['CONFLICT', 'OK'])
    expect(await prisma.waitlistEntry.count({ where: { kosId: k.kos.id, userId: s.id, status: { in: ['WAITING', 'OFFERED'] } } })).toBe(1)
    void joinQueue
  })
})

describe('[G-035][R-056] two simultaneous reviews of one tenancy', () => {
  it('stores one review; the other is a CONFLICT', async () => {
    const s = await newStudent()
    const { tenancy } = await paidTenancy(s.id)
    const c = callerFor(s.id)
    const input = { tenancyId: tenancy.id, rating: 4, subRatings: {}, comment: 'Bagus.' }

    const out = await settled(c.review.create(input), c.review.create(input))

    expect(out.map(codeOf).sort()).toEqual(['CONFLICT', 'OK'])
    expect(await prisma.review.count({ where: { tenancyId: tenancy.id } })).toBe(1)
  })
})

describe('[G-036][R-068] abuse caps under parallel requests', () => {
  it('never lets parallel room.create calls exceed 40 rooms in a kos', async () => {
    const o = await newOwner()
    const kos = await o.c.owner.kos.create(kosInput({ initialRooms: { count: 38, priceMonthly: 1_000_000 } }) as never)
    expect(await prisma.room.count({ where: { kosId: kos.id } })).toBe(38)

    const out = await settled(...Array.from({ length: 10 }, (_, i) => o.c.owner.room.create({ ...roomInput({ roomNumber: `P${i}` }), kosId: kos.id } as never)))

    // Exactly two fit; the other eight are refused by the cap itself, not by a lock timeout.
    expect(out.map(codeOf).sort()).toEqual(['CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT', 'OK', 'OK'])
    for (const r of out) if (r.status === 'rejected') expect((r.reason as Error).message).toContain('maksimal 40 kamar')
    expect(await prisma.room.count({ where: { kosId: kos.id, archivedAt: null } })).toBe(40)
  })

  // F-001: the per-owner kos cap used to be checked outside the insert, so parallel creates overshot it (observed 7 kos).
  it('never lets parallel kos.create calls exceed 5 kos for one owner', async () => {
    const o = await newOwner()
    for (let i = 0; i < 4; i++) await o.c.owner.kos.create(kosInput({ name: `Kos ${i}` }) as never)

    const out = await settled(...Array.from({ length: 3 }, (_, i) => o.c.owner.kos.create(kosInput({ name: `Paralel ${i}` }) as never)))

    expect(out.map(codeOf).sort()).toEqual(['CONFLICT', 'CONFLICT', 'OK'])
    for (const r of out) if (r.status === 'rejected') expect((r.reason as Error).message).toContain('maksimal 5 kos')
    expect(await prisma.kos.count({ where: { ownerId: o.ownerId } })).toBe(5)
  })
})
