import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { caller, callerFor, DEMO_STUDENT_ID, newStudent, prisma } from '../helpers.ts'
import { verifyAtCampus } from './gap-helpers.ts'
import { advanceAllWaitlists } from '../../src/waitlist.ts'

beforeEach(() => resetDb(prisma))
afterEach(() => {
  delete process.env.DEMO_ISOLATION
})

describe('[G4] kos.detail demoBlocked', () => {
  async function ids() {
    const demoKos = await prisma.kos.findFirstOrThrow({ where: { owner: { user: { isDemo: true } } }, select: { id: true } })
    const realKos = await prisma.kos.findFirstOrThrow({ where: { owner: { user: { isDemo: false } }, archivedAt: null }, select: { id: true } })
    return { demoKos: demoKos.id, realKos: realKos.id }
  }

  it('is true across the demo split when isolation is on', async () => {
    const { demoKos, realKos } = await ids()
    const real = await newStudent()
    process.env.DEMO_ISOLATION = '1'
    expect((await caller.kos.detail({ id: demoKos })).demoBlocked).toBe(true)
    expect((await callerFor(real.id).kos.detail({ id: demoKos })).demoBlocked).toBe(true)
    expect((await caller.kos.detail({ id: realKos })).demoBlocked).toBe(false)
    expect((await callerFor(real.id).kos.detail({ id: realKos })).demoBlocked).toBe(false)
    expect((await callerFor(DEMO_STUDENT_ID).kos.detail({ id: demoKos })).demoBlocked).toBe(false)
    expect((await callerFor(DEMO_STUDENT_ID).kos.detail({ id: realKos })).demoBlocked).toBe(true)
  })

  it('is false everywhere when isolation is off', async () => {
    const { demoKos, realKos } = await ids()
    const real = await newStudent()
    for (const c of [caller, callerFor(real.id), callerFor(DEMO_STUDENT_ID)]) {
      expect((await c.kos.detail({ id: demoKos })).demoBlocked).toBe(false)
      expect((await c.kos.detail({ id: realKos })).demoBlocked).toBe(false)
    }
  })
})

describe('[G5-G7] student verification status extras', () => {
  const status = (id: string) => callerFor(id).studentVerification.status()

  it('accountCampusEmail: set for an unverified campus-domain account, null for gmail and for verified', async () => {
    const binus = await newStudent()
    await prisma.user.update({ where: { id: binus.id }, data: { email: 'Budi@Binus.ac.id' } })
    expect((await status(binus.id)).accountCampusEmail).toBe('budi@binus.ac.id')

    const gmail = await newStudent()
    await prisma.user.update({ where: { id: gmail.id }, data: { email: 'budi@gmail.com' } })
    expect((await status(gmail.id)).accountCampusEmail).toBeNull()

    await verifyAtCampus(binus.id)
    expect((await status(binus.id)).accountCampusEmail).toBeNull()
  })

  it('campusId and campusName follow User.verifiedCampusId', async () => {
    const s = await newStudent()
    expect(await status(s.id)).toMatchObject({ campusId: null, campusName: null })
    await verifyAtCampus(s.id, 'binus-syahdan')
    const c = await prisma.campus.findUniqueOrThrow({ where: { id: 'binus-syahdan' }, select: { name: true } })
    expect(await status(s.id)).toMatchObject({ state: 'VERIFIED', campusId: 'binus-syahdan', campusName: c.name })
  })

  it('lastRejectedDraft is filled only in REJECTED', async () => {
    const s = await newStudent()
    expect((await status(s.id)).lastRejectedDraft).toBeNull()
    const createdAt = new Date()
    const d = await prisma.studentDocument.create({
      data: { userId: s.id, key: `private/ktm/${s.id}/1`, contentType: 'image/jpeg', status: 'PENDING', consentAt: createdAt, createdAt, campusId: 'binus-syahdan', nameOnCard: 'Budi Santoso', nim: '2501234567', program: 'Ilmu Komputer' },
    })
    expect(await status(s.id)).toMatchObject({ state: 'PENDING', lastRejectedDraft: null })
    await prisma.studentDocument.update({ where: { id: d.id }, data: { status: 'REJECTED', reason: 'Foto buram', reviewer: 'staff' } })
    const c = await prisma.campus.findUniqueOrThrow({ where: { id: 'binus-syahdan' }, select: { name: true } })
    expect(await status(s.id)).toMatchObject({
      state: 'REJECTED',
      lastRejectedDraft: { campusId: 'binus-syahdan', campusName: c.name, nameOnCard: 'Budi Santoso', nim: '2501234567', program: 'Ilmu Komputer' },
    })
    await prisma.studentDocument.update({ where: { id: d.id }, data: { deletedAt: new Date() } })
    expect(await status(s.id)).toMatchObject({ state: 'NONE', lastRejectedDraft: null })
  })
})

describe('[SIM-027] waitlist aheadOffer', () => {
  async function queue() {
    const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { user: { isDemo: false } }, orderBy: { id: 'asc' } })
    const kos = await prisma.kos.create({
      data: {
        slug: 'antre-ahead',
        name: 'Kos Antre Ahead',
        gender: 'CAMPUR',
        address: 'Jl. Antre',
        district: 'Kebayoran',
        city: 'Jakarta',
        lat: -6.2,
        lng: 106.8,
        electricityType: 'INCLUDED',
        ownerId: owner.id,
        rooms: { create: [{ roomNumber: 'S1', floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 1_500_000 }] },
      },
      include: { rooms: true },
    })
    const tenant = await newStudent()
    const tenancy = await prisma.tenancy.create({ data: { roomId: kos.rooms[0].id, userId: tenant.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 } })
    const a = await newStudent()
    const b = await newStudent()
    const ea = await callerFor(a.id).waitlist.join({ kosId: kos.id, roomType: null })
    const eb = await callerFor(b.id).waitlist.join({ kosId: kos.id, roomType: null })
    await prisma.tenancy.update({ where: { id: tenancy.id }, data: { status: 'ENDED' } })
    await advanceAllWaitlists(prisma, new Date())
    return { kosId: kos.id, a: callerFor(a.id), b: callerFor(b.id), ea, eb }
  }

  it('is set for the student behind a live offer, never exposes who holds it, and clears on expiry', async () => {
    const q = await queue()
    const offered = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: q.ea.id } })
    expect(offered.status).toBe('OFFERED')
    const st = await q.b.waitlist.status({ kosId: q.kosId })
    expect(st.mine).toMatchObject({ status: 'WAITING', position: 1, aheadOffer: { expiresAt: offered.offerExpiresAt!.toISOString() } })
    expect(Object.keys(st.mine!.aheadOffer!)).toEqual(['expiresAt'])
    const mine = await q.b.waitlist.mine()
    expect(mine.find((e) => e.id === q.eb.id)?.aheadOffer?.expiresAt).toBe(offered.offerExpiresAt!.toISOString())
    // The offeree's own entry has no aheadOffer.
    expect((await q.a.waitlist.mine()).find((e) => e.id === q.ea.id)?.aheadOffer).toBeNull()

    await prisma.waitlistEntry.update({ where: { id: q.ea.id }, data: { offerExpiresAt: new Date(Date.now() - 60_000) } })
    expect((await q.b.waitlist.status({ kosId: q.kosId })).mine?.aheadOffer).toBeNull()
    expect((await q.b.waitlist.mine()).find((e) => e.id === q.eb.id)?.aheadOffer).toBeNull()
  })

  it('is null after the offer is declined', async () => {
    const q = await queue()
    expect((await q.b.waitlist.status({ kosId: q.kosId })).mine?.aheadOffer).not.toBeNull()
    await q.a.waitlist.decline({ entryId: q.ea.id })
    const after = await q.b.waitlist.status({ kosId: q.kosId })
    expect(after.mine?.aheadOffer).toBeNull()
  })
})
