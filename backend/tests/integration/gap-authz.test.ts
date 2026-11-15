import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { caller, callerFor, DEMO_STUDENT_ID, newStudent, prisma, vacantRoom } from '../helpers.ts'
import { call, code, err, pendingApplication, snapshot, twoOwners } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

// The authorization root (spec section 5): the 31 procedures whose input carries a kosId that must belong to the caller.
const OWNER_KOS_PROCEDURES = [
  'owner.board', 'owner.reviews', 'owner.images', 'owner.image.presign', 'owner.image.confirm', 'owner.image.delete', 'owner.image.reorder', 'owner.visits',
  'owner.visit.complete', 'owner.waitlistEntries', 'owner.waitlist.remove', 'owner.places.list', 'owner.places.hide', 'owner.places.unhide', 'owner.places.add',
  'owner.places.remove', 'owner.places.refresh', 'owner.places.preview', 'owner.tenant.notifications', 'owner.tenant.tenantProfile', 'owner.kos.update',
  'owner.kos.delete', 'owner.room.create', 'owner.room.update', 'owner.room.delete', 'owner.rules.set', 'owner.tenancy.end', 'application.ownerList',
  'application.decide', 'payment.recordManual', 'review.reply',
]
// Signed-in-only procedures (any account): anonymous callers get UNAUTHORIZED. 'owner.kos.create' and 'owner.myKos' are checked separately.
const SIGNED_IN_ONLY = [
  'auth.updateProfile', 'auth.updateEmergencyContact', 'auth.clearEmergencyContact', 'auth.acceptTerms', 'auth.setNotifyOptOut', 'owner.becomeOwner',
  'application.create', 'application.mine', 'booking.mine', 'payment.start', 'payment.status', 'payment.reconcile', 'payment.simulate', 'place.resolveAddress',
  'place.reverse', 'kuitansi.get', 'review.create', 'review.update', 'visit.create', 'visit.mine', 'visit.cancel', 'waitlist.join', 'waitlist.leave',
  'waitlist.decline', 'waitlist.mine', 'demo.reset', 'catalog.status',
]
// Public procedures (14): a missing session never produces UNAUTHORIZED.
const PUBLIC = ['auth.providers', 'auth.me', 'kos.list', 'kos.search', 'kos.detail', 'owner.publicProfile', 'place.search', 'waitlist.status', 'region.children', 'region.get', 'region.outline', 'region.search', 'campus.search', 'catalog.licenses']

describe('[G-001][R-001] application.decide across owners', () => {
  it('refuses another owner and leaves the application PENDING, with no tenancy or invoice', async () => {
    const { a, b } = await twoOwners()
    const kosA = a.kos[0]!
    const room = await prisma.room.findFirstOrThrow({ where: { kosId: kosA.id, tenancies: { none: { status: { in: ['ACTIVE', 'PENDING'] } } } } })
    const { applicationId } = await pendingApplication(room.id)
    const before = await snapshot()

    const e = await err(callerFor(b.userId).application.decide({ kosId: kosA.id, applicationId, decision: 'APPROVE' }))

    expect(e?.code).toBe('FORBIDDEN')
    expect(e?.message).toBe('Anda tidak memiliki akses ke kos ini.')
    expect(await prisma.rentalApplication.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({ status: 'PENDING' })
    expect(await snapshot()).toEqual(before)
  })

  it('also refuses a student and a signed-out caller, and rejects an invalid decision', async () => {
    const { a } = await twoOwners()
    const kosA = a.kos[0]!
    const room = await prisma.room.findFirstOrThrow({ where: { kosId: kosA.id, tenancies: { none: { status: { in: ['ACTIVE', 'PENDING'] } } } } })
    const { applicationId, renter } = await pendingApplication(room.id)
    expect(await code(callerFor(renter.id).application.decide({ kosId: kosA.id, applicationId, decision: 'APPROVE' }))).toBe('FORBIDDEN')
    expect(await code(caller.application.decide({ kosId: kosA.id, applicationId, decision: 'APPROVE' }))).toBe('UNAUTHORIZED')
    const bad = await err(callerFor(a.userId).application.decide({ kosId: kosA.id, applicationId, decision: 'MAYBE' } as never))
    expect(bad?.code).toBe('BAD_REQUEST')
    expect(await prisma.rentalApplication.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({ status: 'PENDING' })
  })
})

describe("[G-002][R-002] application.decide with another kos's application id", () => {
  it('answers NOT_FOUND "Pengajuan tidak ditemukan." and leaves the other owner\'s application alone', async () => {
    const { a, b } = await twoOwners()
    const kosA = a.kos[0]!
    const roomA = await prisma.room.findFirstOrThrow({ where: { kosId: kosA.id, tenancies: { none: { status: { in: ['ACTIVE', 'PENDING'] } } } } })
    const { applicationId } = await pendingApplication(roomA.id)

    const e = await err(callerFor(b.userId).application.decide({ kosId: b.kos[0]!.id, applicationId, decision: 'APPROVE' }))

    expect(e?.code).toBe('NOT_FOUND')
    expect(e?.message).toBe('Pengajuan tidak ditemukan.')
    expect(await prisma.rentalApplication.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({ status: 'PENDING' })
    expect(await prisma.tenancy.count({ where: { roomId: roomA.id, status: { in: ['PENDING', 'ACTIVE'] } } })).toBe(0)
  })
})

describe('[G-003][R-001][R-002][R-003] authorization matrix for every owner(kosId) procedure', () => {
  it('denies a foreign owner, a student and a signed-out caller, and changes no row', async () => {
    const { a, b } = await twoOwners()
    const kosId = a.kos[0]!.id
    const student = await newStudent()
    const before = await snapshot()
    const cells: string[] = []

    for (const proc of OWNER_KOS_PROCEDURES) {
      const input = { kosId }
      const foreign = await err(call(callerFor(b.userId), proc, input) as Promise<unknown>)
      const stud = await err(call(callerFor(student.id), proc, input) as Promise<unknown>)
      const anon = await err(call(caller, proc, input) as Promise<unknown>)
      if (foreign?.code !== 'FORBIDDEN' || foreign.message !== 'Anda tidak memiliki akses ke kos ini.') cells.push(`${proc}/foreign owner -> ${foreign?.code}: ${foreign?.message}`)
      if (stud?.code !== 'FORBIDDEN' || stud.message !== 'Anda tidak memiliki akses ke kos ini.') cells.push(`${proc}/student -> ${stud?.code}: ${stud?.message}`)
      if (anon?.code !== 'UNAUTHORIZED') cells.push(`${proc}/anonymous -> ${anon?.code}`)
    }

    expect(cells).toEqual([])
    expect(await snapshot()).toEqual(before)
  })

  it('lists exactly the 31 owner procedures (a new one without a cell is a failing test)', async () => {
    const { appRouter } = await import('../../src/trpc/router.ts')
    const all = Object.keys((appRouter as any)._def.procedures) as string[]
    expect(all).toHaveLength(OWNER_KOS_PROCEDURES.length + SIGNED_IN_ONLY.length + PUBLIC.length + 2)
    expect(new Set([...OWNER_KOS_PROCEDURES, ...SIGNED_IN_ONLY, ...PUBLIC, 'owner.myKos', 'owner.kos.create'])).toEqual(new Set(all))
  })
})

describe('[G-004][R-003] owner-only procedures without a kosId', () => {
  it('refuses a student ("Fitur ini khusus pemilik kos.") and a signed-out caller, and creates no kos', async () => {
    const student = await newStudent()
    const before = await snapshot()
    const create = { name: 'X', gender: 'CAMPUR', address: 'Jl. A', district: 'D', city: 'C', lat: -6.2, lng: 106.8, electricityType: 'TOKEN', studentDiscountAmount: 0 }
    for (const c of [callerFor(student.id), callerFor(DEMO_STUDENT_ID)]) {
      const mine = await err(c.owner.myKos())
      const made = await err(c.owner.kos.create(create as never))
      expect([mine?.code, mine?.message]).toEqual(['FORBIDDEN', 'Fitur ini khusus pemilik kos.'])
      expect([made?.code, made?.message]).toEqual(['FORBIDDEN', 'Fitur ini khusus pemilik kos.'])
    }
    expect(await code(caller.owner.myKos())).toBe('UNAUTHORIZED')
    expect(await code(caller.owner.kos.create(create as never))).toBe('UNAUTHORIZED')
    expect(await snapshot()).toEqual(before)
  })
})

describe('[G-005][R-003] signed-in-only versus public procedures', () => {
  it('answers UNAUTHORIZED "Silakan masuk terlebih dahulu." to a signed-out caller on all 27 signed-in-only procedures', async () => {
    const before = await snapshot()
    const wrong: string[] = []
    for (const proc of SIGNED_IN_ONLY) {
      const e = await err(call(caller, proc, { kosId: 'x', invoiceId: 'x', paymentId: 'x', entryId: 'x', visitId: 'x' }) as Promise<unknown>)
      if (e?.code !== 'UNAUTHORIZED' || e.message !== 'Silakan masuk terlebih dahulu.') wrong.push(`${proc} -> ${e?.code}: ${e?.message}`)
    }
    expect(wrong).toEqual([])
    expect(await snapshot()).toEqual(before)
  })

  it('never answers UNAUTHORIZED on the 14 public procedures', async () => {
    const wrong: string[] = []
    for (const proc of PUBLIC) {
      const e = await err(call(caller, proc, { id: 'does-not-exist', kosId: 'x', code: '99', q: 'ab', parentCode: undefined, lat: -6.2, lng: 106.8 }) as Promise<unknown>)
      if (e?.code === 'UNAUTHORIZED') wrong.push(proc)
    }
    expect(wrong).toEqual([])
  })
})

describe('[G-006][R-026][R-027] another user\'s payment', () => {
  it('payment.reconcile and payment.simulate deny a stranger and a signed-out caller and leave the attempt unchanged', async () => {
    const owner = await prisma.ownerProfile.findFirstOrThrow({ select: { userId: true } })
    void owner
    const room = await vacantRoom()
    const { approveApplication } = await import('../helpers.ts')
    const student = await newStudent()
    const stranger = await newStudent()
    const a = await approveApplication(student.id, room.id)
    const started = await callerFor(student.id).payment.start({ invoiceId: a.invoiceId })
    const paymentId = started.paymentId
    const before = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })

    for (const proc of ['payment.reconcile', 'payment.simulate'] as const) {
      const e = await err(call(callerFor(stranger.id), proc, { paymentId }) as Promise<unknown>)
      expect(['NOT_FOUND', 'FORBIDDEN']).toContain(e?.code)
      expect(await code(call(caller, proc, { paymentId }) as Promise<unknown>)).toBe('UNAUTHORIZED')
    }

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
    expect(after.status).toBe(before.status)
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: a.invoiceId } })).status).toBe('UNPAID')
  })
})

describe('[G-007][R-094] auth.setNotifyOptOut', () => {
  it('persists the flag both ways, rejects a non-boolean and a signed-out caller', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    await c.auth.setNotifyOptOut({ optOut: true })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).notifyOptOut).toBe(true)
    await c.auth.setNotifyOptOut({ optOut: false })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).notifyOptOut).toBe(false)
    const bad = await err(c.auth.setNotifyOptOut({ optOut: 'yes' } as never))
    expect(bad?.code).toBe('BAD_REQUEST')
    expect(await code(caller.auth.setNotifyOptOut({ optOut: true }))).toBe('UNAUTHORIZED')
  })
})

describe('[G-008][R-089] profile procedures without a session or with bad input', () => {
  it('denies a signed-out caller and stores nothing', async () => {
    const before = await snapshot()
    expect(await code(caller.auth.clearEmergencyContact())).toBe('UNAUTHORIZED')
    expect(await code(caller.auth.acceptTerms({ version: 'x' }))).toBe('UNAUTHORIZED')
    expect(await code(caller.auth.updateEmergencyContact({ name: 'Bu Sari', relation: 'Ibu', phone: '081200000009', consent: true }))).toBe('UNAUTHORIZED')
    expect(await snapshot()).toEqual(before)
  })

  it('rejects acceptTerms with an empty or 41-character version', async () => {
    const s = await newStudent()
    for (const version of ['', 'v'.repeat(41)]) {
      const e = await err(callerFor(s.id).auth.acceptTerms({ version }))
      expect(e?.code).toBe('BAD_REQUEST')
    }
  })
})

