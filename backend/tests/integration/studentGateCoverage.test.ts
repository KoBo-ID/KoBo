// C-09: studentGate production default and a verification that expires after the application was filed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { studentVerificationRequired } from '../../src/studentGate.ts'
import { callerFor, newStudent, prisma, vacantRoom } from '../helpers.ts'
import { err, startIn } from './gap-helpers.ts'

const DAY = 86_400_000
const GATE_MESSAGE = 'Verifikasi status mahasiswa Anda dulu di halaman Profil sebelum menyewa.'

beforeEach(async () => {
  delete process.env.REQUIRE_STUDENT_VERIFICATION
  await resetDb(prisma)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  delete process.env.REQUIRE_STUDENT_VERIFICATION
})

describe('studentVerificationRequired default', () => {
  it('is off outside production, on in production, and the explicit flag wins either way', () => {
    expect(studentVerificationRequired()).toBe(false) // NODE_ENV=test, flag unset
    vi.stubEnv('NODE_ENV', 'production')
    expect(studentVerificationRequired()).toBe(true)
    vi.stubEnv('REQUIRE_STUDENT_VERIFICATION', '0')
    expect(studentVerificationRequired()).toBe(false)
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('REQUIRE_STUDENT_VERIFICATION', '1')
    expect(studentVerificationRequired()).toBe(true)
    vi.stubEnv('REQUIRE_STUDENT_VERIFICATION', '')
    expect(studentVerificationRequired()).toBe(false) // an empty value is "unset"
  })

  it('refuses an unverified student on application.create, visit.create and waitlist.join with the flag unset in production', async () => {
    const room = await vacantRoom()
    const s = await newStudent()
    vi.stubEnv('NODE_ENV', 'production')
    const c = callerFor(s.id)
    for (const p of [
      c.application.create({ roomId: room.id, startDate: startIn(3), durationMonths: 3 }),
      c.visit.create({ kosId: room.kosId, date: startIn(3), timeSlot: 'PAGI' }),
      c.waitlist.join({ kosId: room.kosId, roomType: null }),
    ]) {
      const e = await err(p)
      expect([e?.code, e?.message]).toEqual(['PRECONDITION_FAILED', GATE_MESSAGE])
    }
    expect(await prisma.rentalApplication.count({ where: { userId: s.id } })).toBe(0)
  })

  it('lets a verified student through in production with the flag unset', async () => {
    const room = await vacantRoom()
    const s = await newStudent()
    await prisma.user.update({ where: { id: s.id }, data: { campusEmailVerifiedAt: new Date(), campusVerifiedVia: 'EMAIL', campusVerifiedUntil: new Date(Date.now() + 30 * DAY), campus: 'BINUS' } })
    vi.stubEnv('NODE_ENV', 'production')
    // visit.create, not application.create: production also switches on the emergency-contact/terms consent checks.
    expect((await callerFor(s.id).visit.create({ kosId: room.kosId, date: startIn(3), timeSlot: 'PAGI' })).id).toBeTruthy()
  })
})

describe('verification that expires after the application was filed', () => {
  it('still lets the owner decide, with no student discount, and blocks the student from filing again', async () => {
    process.env.REQUIRE_STUDENT_VERIFICATION = '1'
    const room = await vacantRoom()
    await prisma.kos.update({ where: { id: room.kosId }, data: { studentDiscountAmount: 150_000 } })
    const owner = await prisma.kos.findUniqueOrThrow({ where: { id: room.kosId }, select: { owner: { select: { userId: true } } } })
    const s = await newStudent()
    const until = new Date(Date.now() + 2 * DAY)
    await prisma.user.update({ where: { id: s.id }, data: { campusEmailVerifiedAt: new Date(), campusVerifiedVia: 'EMAIL', campusVerifiedUntil: until, campus: 'BINUS' } })

    const created = await callerFor(s.id).application.create({ roomId: room.id, startDate: startIn(4), durationMonths: 3 })

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(until.getTime() + 60_000))

    // A second application is refused now...
    const again = await err(callerFor(s.id).application.create({ roomId: room.id, startDate: startIn(4), durationMonths: 3 }))
    expect([again?.code, again?.message]).toEqual(['PRECONDITION_FAILED', GATE_MESSAGE])

    // ...but the owner can still decide the one already filed; the discount is judged at decide time.
    const decision = await callerFor(owner.owner.userId).application.decide({ kosId: room.kosId, applicationId: created.id, decision: 'APPROVE' })
    expect(decision.tenancyId).toBeTruthy()
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenancyId: decision.tenancyId! } })
    expect(invoice.discountAmount).toBe(0)
  })
})
