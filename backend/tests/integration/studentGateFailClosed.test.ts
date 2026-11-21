import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { resetDb } from '../../src/db/seed.ts'
import { NoGeocoder } from '../../src/geocode.ts'
import { STUDENT_KOS_KEYS, createCallerFactory, router, studentProcedure, type Context } from '../../src/trpc/trpc.ts'
import { auth, callerFor, createPendingMockPayment, newStudent, paymentService, prisma, storage } from '../helpers.ts'
import { err, makeKos, startIn } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

// X3: studentProcedure resolves the kos from every rental input key it can receive, then checks the owner's approval.
// A probe procedure on the real middleware accepts any object, so each key is exercised without a rental fixture per route.
const probe = router({ ping: studentProcedure.input(z.record(z.string(), z.unknown())).query(() => 'ok') })
const probeFor = (userId: string) => {
  const session = { user: { id: userId, isDemo: false }, session: { userId } } as never
  const ctx: Context = { prisma, auth, storage, paymentService, geocoder: new NoGeocoder(), headers: new Headers(), resHeaders: new Headers(), getSession: async () => session }
  return createCallerFactory(probe)(ctx)
}

async function fixture() {
  const k = await makeKos([{ n: 'F1', type: 'Standar' }])
  const room = k.room('F1')
  const tenant = await newStudent()
  const tenancy = await prisma.tenancy.create({ data: { roomId: room.id, userId: tenant.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 3 } })
  const invoice = await prisma.invoice.create({
    data: { tenancyId: tenancy.id, periodStart: new Date(), dueDate: new Date(), amount: 1_000_000, rentAmount: 1_000_000, discountAmount: 0, applicationFeeAmount: 0, ownerReceivableAmount: 1_000_000, gatewayFeeBearer: 'PLATFORM' },
  })
  const payment = await createPendingMockPayment(invoice.id)
  const application = await prisma.rentalApplication.create({ data: { roomId: room.id, userId: tenant.id, startDate: new Date(), durationMonths: 3 } })
  const visit = await prisma.visit.create({ data: { kosId: k.kos.id, userId: tenant.id, date: new Date(), timeSlot: 'PAGI' } })
  const entry = await prisma.waitlistEntry.create({ data: { kosId: k.kos.id, userId: tenant.id } })
  const ids: Record<(typeof STUDENT_KOS_KEYS)[number], string> = {
    kosId: k.kos.id,
    roomId: room.id,
    applicationId: application.id,
    visitId: visit.id,
    waitlistEntryId: entry.id,
    invoiceId: invoice.id,
    tenancyId: tenancy.id,
    paymentId: payment.id,
  }
  const ownerId = k.kos.ownerId
  return { k, ids, ownerId }
}

describe('studentProcedure resolves the kos for every rental key', () => {
  it('knows exactly the documented keys', () => {
    expect([...STUDENT_KOS_KEYS]).toEqual(['kosId', 'roomId', 'applicationId', 'visitId', 'waitlistEntryId', 'invoiceId', 'tenancyId', 'paymentId'])
  })

  for (const key of STUDENT_KOS_KEYS) {
    it(`${key}: NOT_FOUND while the owner is MENUNGGU, DITOLAK or BELUM_KIRIM, allowed once DISETUJUI`, async () => {
      const { ids, ownerId } = await fixture()
      const s = await newStudent()
      for (const status of ['MENUNGGU', 'DITOLAK', 'BELUM_KIRIM'] as const) {
        await prisma.ownerProfile.update({ where: { id: ownerId }, data: { verificationStatus: status } })
        expect((await err(probeFor(s.id).ping({ [key]: ids[key] })))?.code).toBe('NOT_FOUND')
      }
      await prisma.ownerProfile.update({ where: { id: ownerId }, data: { verificationStatus: 'DISETUJUI' } })
      expect(await probeFor(s.id).ping({ [key]: ids[key] })).toBe('ok')
    })
  }

  it('an unknown id falls through so the procedure keeps its own NOT_FOUND', async () => {
    const s = await newStudent()
    expect(await probeFor(s.id).ping({ kosId: 'does-not-exist' })).toBe('ok')
  })

  it('an input with none of the known keys fails closed (FORBIDDEN)', async () => {
    const s = await newStudent()
    for (const input of [{}, { somethingElse: 'x' }, { kosId: '' }, { kosId: 42 }]) {
      expect((await err(probeFor(s.id).ping(input)))?.code).toBe('FORBIDDEN')
    }
  })
})

// Every real procedure built on studentProcedure, with the key its input carries. Add a row when one is added.
describe('real studentProcedure routes refuse an unapproved owner', () => {
  it('application.create (roomId), visit.create (kosId), waitlist.join (kosId)', async () => {
    const { k, ownerId } = await fixture()
    await prisma.ownerProfile.update({ where: { id: ownerId }, data: { verificationStatus: 'MENUNGGU' } })
    const c = callerFor((await newStudent()).id)
    const results = [
      await err(c.application.create({ roomId: k.room('F1').id, startDate: startIn(3), durationMonths: 3 })),
      await err(c.visit.create({ kosId: k.kos.id, date: startIn(3), timeSlot: 'PAGI' })),
      await err(c.waitlist.join({ kosId: k.kos.id, roomType: null })),
    ]
    expect(results.map((e) => e?.code)).toEqual(['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND'])
  })
})
