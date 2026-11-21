import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { approveApplication, callerFor, DEMO_STUDENT_ID, newStudent, prisma, vacantRoom } from '../helpers.ts'
import { err, makeKos, startIn } from './gap-helpers.ts'

const GATE_MESSAGE = 'Verifikasi status mahasiswa Anda dulu di halaman Profil sebelum menyewa.'
const DAY = 86_400_000

beforeEach(async () => {
  process.env.REQUIRE_STUDENT_VERIFICATION = '1'
  await resetDb(prisma)
})
afterEach(() => {
  delete process.env.REQUIRE_STUDENT_VERIFICATION
  vi.useRealTimers()
})

const verify = (id: string, via: 'EMAIL' | 'MICROSOFT' | 'GOOGLE' | 'KTM', until: Date | null = new Date(Date.now() + 30 * DAY)) =>
  prisma.user.update({ where: { id }, data: { campusEmailVerifiedAt: new Date(), campusVerifiedVia: via, campusVerifiedUntil: until, campus: 'BINUS', verifiedCampusId: 'binus-syahdan' } })

const applyIn = (userId: string, roomId: string) => callerFor(userId).application.create({ roomId, startDate: startIn(3), durationMonths: 3 })
const visitIn = (userId: string, kosId: string) => callerFor(userId).visit.create({ kosId, date: startIn(3), timeSlot: 'PAGI' })

async function refusedBy(p: Promise<unknown>) {
  const e = await err(p)
  expect([e?.code, e?.message]).toEqual(['PRECONDITION_FAILED', GATE_MESSAGE])
  return e
}

describe('student gate', () => {
  it('refuses an unverified user on application.create, visit.create and waitlist.join', async () => {
    const room = await vacantRoom()
    const s = await newStudent()
    const e = await refusedBy(applyIn(s.id, room.id))
    expect((e as { cause?: Error }).cause?.message).toBe('STUDENT_VERIFICATION_REQUIRED')
    await refusedBy(visitIn(s.id, room.kosId))
    await refusedBy(callerFor(s.id).waitlist.join({ kosId: room.kosId, roomType: null }))
    expect(await prisma.rentalApplication.count({ where: { userId: s.id } })).toBe(0)
  })

  it('refuses an expired verification (pinned clock) and allows it just before expiry', async () => {
    const room = await vacantRoom()
    const s = await newStudent()
    const until = new Date(Date.now() + 10 * DAY)
    await verify(s.id, 'EMAIL', until)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(until.getTime() + 1000))
    await refusedBy(applyIn(s.id, room.id))
    vi.setSystemTime(new Date(until.getTime() - 60_000))
    expect((await applyIn(s.id, room.id)).status).toBe('PENDING')
  })

  it.each(['EMAIL', 'MICROSOFT', 'GOOGLE', 'KTM'] as const)('allows a student verified via %s and snapshots occupation', async (via) => {
    const room = await vacantRoom()
    const s = await newStudent()
    await verify(s.id, via)
    const created = await callerFor(s.id).application.create({ roomId: room.id, startDate: startIn(3), durationMonths: 3, program: 'Informatika', semester: 5 })
    const row = await prisma.rentalApplication.findUniqueOrThrow({ where: { id: created.id } })
    expect(row).toMatchObject({ occupation: 'Mahasiswa BINUS', program: 'Informatika', semester: 5 })
    const visit = await visitIn(s.id, room.kosId)
    expect(visit.id).toBeTruthy()
  })

  it('allows a legacy verification with no expiry', async () => {
    const room = await vacantRoom()
    const s = await newStudent()
    await verify(s.id, 'EMAIL', null)
    expect((await applyIn(s.id, room.id)).status).toBe('PENDING')
  })

  it('exempts demo users', async () => {
    const room = await vacantRoom()
    await prisma.user.update({ where: { id: DEMO_STUDENT_ID }, data: { campusEmailVerifiedAt: null, campusVerifiedUntil: null } })
    const e = await err(applyIn(DEMO_STUDENT_ID, room.id))
    expect(e?.message).not.toBe(GATE_MESSAGE)
  })

  it('is off with REQUIRE_STUDENT_VERIFICATION=0', async () => {
    process.env.REQUIRE_STUDENT_VERIFICATION = '0'
    const room = await vacantRoom()
    const s = await newStudent()
    expect((await applyIn(s.id, room.id)).status).toBe('PENDING')
  })

  it('lets an unverified user keep and end existing entries, and read application.mine', async () => {
    process.env.REQUIRE_STUDENT_VERIFICATION = '0'
    const room = await vacantRoom()
    const s = await newStudent()
    const c = callerFor(s.id)
    const visit = await visitIn(s.id, room.kosId)
    const app = await applyIn(s.id, room.id)
    const k = await makeKos([{ n: 'F1', type: 'Standar' }])
    const entry = await prisma.waitlistEntry.create({ data: { kosId: k.kos.id, userId: s.id, roomType: null } })
    process.env.REQUIRE_STUDENT_VERIFICATION = '1'
    expect((await c.application.mine()).map((a) => a.id)).toEqual([app.id])
    await c.visit.cancel({ visitId: visit.id })
    await c.waitlist.leave({ entryId: entry.id })
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).not.toBe('WAITING')
  })

  it('gives no student discount at decide time once the verification has expired', async () => {
    process.env.REQUIRE_STUDENT_VERIFICATION = '0'
    const k = await makeKos([{ n: 'D1', type: 'Standar', price: 1_500_000 }, { n: 'D2', type: 'Standar', price: 1_500_000 }], { studentDiscountAmount: 200_000 })
    const fresh = await newStudent()
    const stale = await newStudent()
    await verify(fresh.id, 'EMAIL', new Date(Date.now() + 30 * DAY))
    await verify(stale.id, 'EMAIL', new Date(Date.now() - DAY))
    const a = await approveApplication(fresh.id, k.room('D1').id)
    const b = await approveApplication(stale.id, k.room('D2').id)
    expect(a.invoice.discountAmount).toBe(200_000)
    expect(b.invoice.discountAmount).toBe(0)
  })

  it('auth.me reports campusVerified expiry-aware plus studentVerification', async () => {
    const s = await newStudent()
    expect(await callerFor(s.id).auth.me()).toMatchObject({ campusVerified: false, studentVerification: { state: 'NONE' } })
    await verify(s.id, 'GOOGLE', new Date(Date.now() - DAY))
    expect(await callerFor(s.id).auth.me()).toMatchObject({ campusVerified: false, studentVerification: { state: 'EXPIRED', via: 'GOOGLE' } })
    await verify(s.id, 'GOOGLE')
    expect(await callerFor(s.id).auth.me()).toMatchObject({ campusVerified: true, studentVerification: { state: 'VERIFIED', via: 'GOOGLE', campus: 'BINUS' } })
  })

  it('ownerList carries student, program and semester', async () => {
    const room = await vacantRoom()
    const s = await newStudent()
    await verify(s.id, 'KTM')
    await callerFor(s.id).application.create({ roomId: room.id, startDate: startIn(3), durationMonths: 3, program: 'Hukum', semester: 2 })
    const owner = await prisma.kos.findUniqueOrThrow({ where: { id: room.kosId }, select: { owner: { select: { userId: true } } } })
    const rows = await callerFor(owner.owner.userId).application.ownerList({ kosId: room.kosId })
    expect(rows[0]).toMatchObject({ program: 'Hukum', semester: 2, occupation: 'Mahasiswa BINUS', student: { verified: true, via: 'KTM', campus: 'BINUS' } })
  })
})
