import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_EMAILS } from '../../src/demo.ts'
import { resetDemo } from '../../src/demoReset.ts'
import { resetDb } from '../../src/db/seed.ts'
import { advanceAllWaitlists } from '../../src/waitlist.ts'
import { isDuplicatePendingError } from '../../src/trpc/application.ts'
import { approveApplication, caller, callerFor, DEMO_STUDENT_ID, newStudent, prisma } from '../helpers.ts'
import { err, makeKos, occupy, startIn } from './gap-helpers.ts'

// Only Date is faked: faking timers would hang pg.
const at = (iso: string) => vi.setSystemTime(new Date(iso))

beforeEach(async () => {
  vi.useRealTimers()
  await resetDb(prisma)
})
afterEach(() => {
  vi.useRealTimers()
  delete process.env.REQUIRE_STUDENT_VERIFICATION
})

const demoOwner = () => prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAILS.owner }, include: { ownerProfile: true } })

describe('A-002: kos.delete (archive branch) closes rooms and the queue', () => {
  it('archives rooms and ends WAITING and OFFERED entries', async () => {
    const k = await makeKos([{ n: 'A1', type: 'Standar' }, { n: 'A2', type: 'Standar' }])
    const roomId = k.room('A1').id
    const past = await newStudent()
    await prisma.tenancy.create({ data: { roomId, userId: past.id, status: 'ENDED', startDate: new Date(), endedAt: new Date(), durationMonths: 3 } })
    const w1 = await newStudent()
    const w2 = await newStudent()
    const waiting = await prisma.waitlistEntry.create({ data: { kosId: k.kos.id, userId: w1.id, roomType: null } })
    const offered = await prisma.waitlistEntry.create({ data: { kosId: k.kos.id, userId: w2.id, roomType: null, status: 'OFFERED', offeredRoomId: k.room('A2').id, offerExpiresAt: new Date(Date.now() - 3600_000) } })

    expect(await k.owner.kos.delete({ kosId: k.kos.id })).toEqual({ id: k.kos.id, archived: true })

    expect(await prisma.room.count({ where: { kosId: k.kos.id, archivedAt: null } })).toBe(0)
    for (const id of [waiting.id, offered.id]) {
      const e = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id } })
      expect(e.status).toBe('REMOVED')
      expect(e.resolvedAt).not.toBeNull()
    }
    await advanceAllWaitlists(prisma)
    expect(await prisma.waitlistEntry.count({ where: { kosId: k.kos.id, status: 'OFFERED' } })).toBe(0)
  })
})

describe('A-005: an unapproved owner is closed to students', () => {
  async function unapproved() {
    const k = await makeKos([{ n: 'U1', type: 'Standar' }])
    const profile = await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: k.kos.id } } } })
    await prisma.ownerProfile.update({ where: { id: profile.id }, data: { approvedAt: null } })
    return { k, profile }
  }

  it('refuses application.create, visit.create and waitlist.join for the kos', async () => {
    const { k } = await unapproved()
    const s = await newStudent()
    const c = callerFor(s.id)
    const a = await err(c.application.create({ roomId: k.room('U1').id, startDate: startIn(3), durationMonths: 3 }))
    const v = await err(c.visit.create({ kosId: k.kos.id, date: startIn(3), timeSlot: 'PAGI' }))
    await occupy(k.room('U1').id)
    const w = await err(c.waitlist.join({ kosId: k.kos.id, roomType: null }))
    expect([a?.code, v?.code, w?.code]).toEqual(['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND'])
    expect(await prisma.rentalApplication.count()).toBe(0)
    expect(await prisma.visit.count({ where: { userId: s.id } })).toBe(0)
    expect(await prisma.waitlistEntry.count({ where: { userId: s.id } })).toBe(0)
  })

  it('works again once approved', async () => {
    const { k, profile } = await unapproved()
    await prisma.ownerProfile.update({ where: { id: profile.id }, data: { approvedAt: new Date() } })
    const s = await newStudent()
    expect((await callerFor(s.id).application.create({ roomId: k.room('U1').id, startDate: startIn(3), durationMonths: 3 })).status).toBe('PENDING')
  })

  it('owner.publicProfile is NOT_FOUND for others but open to the owner', async () => {
    const { k, profile } = await unapproved()
    const e = await err(caller.owner.publicProfile({ id: profile.id }))
    expect(e?.code).toBe('NOT_FOUND')
    const stranger = await newStudent()
    expect((await err(callerFor(stranger.id).owner.publicProfile({ id: profile.id })))?.code).toBe('NOT_FOUND')
    const own = await callerFor(k.ownerUserId).owner.publicProfile({ id: profile.id })
    expect(own.owner.id).toBe(profile.id)
    expect(own.kos.map((x) => x.id)).toContain(k.kos.id)
  })
})

describe('A-010: owner.room.delete and demo reset', () => {
  it('refuses demo owners', async () => {
    const o = await demoOwner()
    const room = await prisma.room.findFirstOrThrow({ where: { kos: { ownerId: o.ownerProfile!.id } } })
    const e = await err(callerFor(o.id).owner.room.delete({ kosId: room.kosId, roomId: room.id }))
    expect(e?.code).toBe('FORBIDDEN')
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).archivedAt).toBeNull()
  })

  it('demoReset clears Room.archivedAt on seeded rooms', async () => {
    const o = await demoOwner()
    const room = await prisma.room.findFirstOrThrow({ where: { kos: { ownerId: o.ownerProfile!.id } } })
    await prisma.room.update({ where: { id: room.id }, data: { archivedAt: new Date() } })
    await resetDemo(prisma)
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).archivedAt).toBeNull()
  })
})

describe('A-017: consent and notification toggles refuse demo users', () => {
  it('clearEmergencyContact, acceptTerms and setNotifyOptOut are FORBIDDEN for the demo student', async () => {
    const c = callerFor(DEMO_STUDENT_ID)
    const { TERMS_VERSION } = await import('@kobo/shared/domain')
    const before = await prisma.user.findUniqueOrThrow({ where: { id: DEMO_STUDENT_ID } })
    const codes = [
      (await err(c.auth.clearEmergencyContact()))?.code,
      (await err(c.auth.acceptTerms({ version: TERMS_VERSION })))?.code,
      (await err(c.auth.setNotifyOptOut({ optOut: !before.notifyOptOut })))?.code,
    ]
    expect(codes).toEqual(['FORBIDDEN', 'FORBIDDEN', 'FORBIDDEN'])
    const after = await prisma.user.findUniqueOrThrow({ where: { id: DEMO_STUDENT_ID } })
    expect([after.notifyOptOut, after.termsVersion]).toEqual([before.notifyOptOut, before.termsVersion])
  })

  it('still works for a normal user', async () => {
    const s = await newStudent()
    await callerFor(s.id).auth.setNotifyOptOut({ optOut: true })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).notifyOptOut).toBe(true)
  })
})

describe('A-013: only the one-pending-per-user-room index means "duplicate application"', () => {
  it('a second pending application for the same room is the friendly CONFLICT', async () => {
    const k = await makeKos([{ n: 'P1', type: 'Standar' }])
    const s = await newStudent()
    const c = callerFor(s.id)
    await c.application.create({ roomId: k.room('P1').id, startDate: startIn(3), durationMonths: 3 })
    const e = await err(c.application.create({ roomId: k.room('P1').id, startDate: startIn(3), durationMonths: 3 }))
    expect([e?.code, e?.message]).toEqual(['CONFLICT', 'Anda sudah memiliki pengajuan aktif untuk kamar ini.'])
  })

  it('other unique violations are not reported as a duplicate', () => {
    expect(isDuplicatePendingError({ code: 'P2002', meta: { target: ['tenancyId'] }, message: 'Unique constraint failed on the fields: (`tenancyId`)' })).toBe(false)
    expect(isDuplicatePendingError({ code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { index: 'rental_application_one_pending_per_user_room' } } } } })).toBe(true)
    expect(isDuplicatePendingError({ message: 'duplicate key value violates unique constraint "rental_application_one_pending_per_user_room"' })).toBe(true)
    expect(isDuplicatePendingError(null)).toBe(false)
  })
})

describe('B-07: impossible calendar dates are refused, not rolled over', () => {
  it('application.create and visit.create reject 2026-11-31', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at('2026-11-20T03:00:00.000Z')
    const k = await makeKos([{ n: 'B1', type: 'Standar' }])
    const s = await newStudent()
    const c = callerFor(s.id)
    expect((await err(c.application.create({ roomId: k.room('B1').id, startDate: '2026-11-31', durationMonths: 3 })))?.code).toBe('BAD_REQUEST')
    expect((await err(c.visit.create({ kosId: k.kos.id, date: '2026-11-31', timeSlot: 'PAGI' })))?.code).toBe('BAD_REQUEST')
    expect(await prisma.rentalApplication.count()).toBe(0)
    expect(await prisma.visit.count({ where: { userId: s.id } })).toBe(0)
    expect((await c.application.create({ roomId: k.room('B1').id, startDate: '2026-11-30', durationMonths: 3 })).status).toBe('PENDING')
  })
})

describe('B-12: demoReset keeps a room that an outside applicant applied to', () => {
  it('does not delete an owner-added room with a real application', async () => {
    const o = await demoOwner()
    const kos = await prisma.kos.findFirstOrThrow({ where: { ownerId: o.ownerProfile!.id } })
    const added = await prisma.room.create({ data: { kosId: kos.id, roomNumber: 'ZZ9', floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 1_000_000 } })
    const lone = await prisma.room.create({ data: { kosId: kos.id, roomNumber: 'ZZ8', floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 1_000_000 } })
    const real = await newStudent()
    const app = await prisma.rentalApplication.create({ data: { roomId: added.id, userId: real.id, startDate: new Date(), durationMonths: 3 } })
    await resetDemo(prisma)
    expect(await prisma.rentalApplication.findUnique({ where: { id: app.id } })).not.toBeNull()
    expect(await prisma.room.findUnique({ where: { id: added.id } })).not.toBeNull()
    expect(await prisma.room.findUnique({ where: { id: lone.id } })).toBeNull()
  })
})

describe('F-11: auth.me.studentVerificationRequired', () => {
  it('follows the flag, and is false for demo users', async () => {
    const s = await newStudent()
    process.env.REQUIRE_STUDENT_VERIFICATION = '1'
    expect((await callerFor(s.id).auth.me())?.studentVerificationRequired).toBe(true)
    expect((await callerFor(DEMO_STUDENT_ID).auth.me())?.studentVerificationRequired).toBe(false)
    process.env.REQUIRE_STUDENT_VERIFICATION = '0'
    expect((await callerFor(s.id).auth.me())?.studentVerificationRequired).toBe(false)
  })
})

describe('A-015: a hold is expired at exactly expiresAt', () => {
  it('another student can apply at the exact instant, and booking.mine no longer offers to pay', async () => {
    const T = new Date('2026-11-10T03:00:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    const k = await makeKos([{ n: 'X1', type: 'Standar' }])
    const s = await newStudent()
    at(T.toISOString())
    const a = await approveApplication(s.id, k.room('X1').id, { startDate: '2026-11-12' })
    expect(a.tenancy.expiresAt!.getTime()).toBe(T.getTime() + 86_400_000)

    vi.setSystemTime(new Date(T.getTime() + 86_400_000 - 1))
    const early = await newStudent()
    expect((await err(callerFor(early.id).application.create({ roomId: k.room('X1').id, startDate: '2026-11-12', durationMonths: 3 })))?.code).toBe('CONFLICT')

    vi.setSystemTime(new Date(T.getTime() + 86_400_000))
    const mine = await callerFor(s.id).booking.mine()
    expect(mine[0]!.invoices[0]!.canPay).toBe(false)
    expect(mine[0]!.endCause).toBe('HOLD_LAPSED')
    const late = await newStudent()
    expect((await callerFor(late.id).application.create({ roomId: k.room('X1').id, startDate: '2026-11-12', durationMonths: 3 })).status).toBe('PENDING')
  })
})

describe('A-011: booking.mine exposes why a tenancy ended', () => {
  it('endCause covers lapsed, owner-cancelled, moved-out, stale pending, live', async () => {
    const T = new Date('2026-11-10T03:00:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    at(T.toISOString())
    const k = await makeKos([{ n: 'E1', type: 'Standar' }])
    const s = await newStudent()
    const roomId = k.room('E1').id
    const mk = (data: { status: 'ENDED' | 'PENDING' | 'ACTIVE'; expiresAt: Date | null; endedAt?: Date | null }) =>
      prisma.tenancy.create({ data: { roomId, userId: s.id, startDate: T, durationMonths: 3, ...data } })
    const h = 3600_000
    const lapsed = await mk({ status: 'ENDED', expiresAt: new Date(T.getTime() - 2 * h), endedAt: new Date(T.getTime() - h) })
    const cancelled = await mk({ status: 'ENDED', expiresAt: new Date(T.getTime() + 20 * h), endedAt: new Date(T.getTime() - h) })
    const movedOut = await mk({ status: 'ENDED', expiresAt: null, endedAt: new Date(T.getTime() - h) })
    const stale = await mk({ status: 'PENDING', expiresAt: new Date(T.getTime() - 1) })
    const mine = await callerFor(s.id).booking.mine()
    const cause = (id: string) => mine.find((m) => m.id === id)!.endCause
    expect([cause(lapsed.id), cause(cancelled.id), cause(movedOut.id), cause(stale.id)]).toEqual(['HOLD_LAPSED', 'CANCELLED_BY_OWNER', 'MOVED_OUT', 'HOLD_LAPSED'])
    await prisma.tenancy.update({ where: { id: stale.id }, data: { status: 'ACTIVE', expiresAt: null } })
    expect((await callerFor(s.id).booking.mine()).find((m) => m.id === stale.id)!.endCause).toBeNull()
  })
})

describe('follow-up 2: refundReason reaches the tenant', () => {
  it('booking.mine and payment.status carry the refund reason', async () => {
    const k = await makeKos([{ n: 'R1', type: 'Standar' }])
    const s = await newStudent()
    const a = await approveApplication(s.id, k.room('R1').id)
    const p = await prisma.payment.create({ data: { invoiceId: a.invoiceId, provider: 'XENDIT', amount: a.invoice.amount, status: 'REFUND_PENDING' } })
    await prisma.paymentRefund.create({ data: { paymentId: p.id, referenceId: `ref-${p.id}`, amount: p.amount, reason: 'HOLD_EXPIRED' } })
    const c = callerFor(s.id)
    expect((await c.payment.status({ paymentId: p.id })).refundReason).toBe('HOLD_EXPIRED')
    expect((await c.booking.mine())[0]!.invoices[0]!.latestPayment?.refundReason).toBe('HOLD_EXPIRED')
  })
})

describe('follow-up 4: rejecting the offeree application passes the room on at once', () => {
  it('offers the room to the next waiter inside decide', async () => {
    const k = await makeKos([{ n: 'W1', type: 'Standar' }])
    const tenancyId = await occupy(k.room('W1').id)
    const a = await newStudent()
    const b = await newStudent()
    const ea = await callerFor(a.id).waitlist.join({ kosId: k.kos.id, roomType: null })
    await prisma.waitlistEntry.update({ where: { id: ea.id }, data: { createdAt: new Date(Date.now() - 60_000) } })
    const eb = await callerFor(b.id).waitlist.join({ kosId: k.kos.id, roomType: null })
    await k.owner.tenancy.end({ kosId: k.kos.id, tenancyId })
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: ea.id } })).status).toBe('OFFERED')
    const app = await callerFor(a.id).application.create({ roomId: k.room('W1').id, startDate: startIn(3), durationMonths: 3 })
    await callerFor(k.ownerUserId).application.decide({ kosId: k.kos.id, applicationId: app.id, decision: 'REJECT' })
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: eb.id } })).status).toBe('OFFERED')
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: ea.id } })).status).toBe('EXPIRED')
  })
})
