import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { caller, callerFor, DEMO_STUDENT_ID, newStudent, prisma } from '../helpers.ts'
import { newOwner, startIn, verifyAtCampus } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))
afterEach(() => {
  delete process.env.DEMO_ISOLATION
})

describe('[SIM-011] demo listings flag and DEMO_ISOLATION filtering', () => {
  it('flags isDemoListing on list, search, and detail; hides demo listings from anonymous and real viewers when DEMO_ISOLATION=1; keeps them for demo viewers and direct kos.detail', async () => {
    const demoKos = await prisma.kos.findFirstOrThrow({ where: { owner: { user: { isDemo: true } } }, select: { id: true } })
    const realKos = await prisma.kos.findFirstOrThrow({ where: { owner: { user: { isDemo: false } }, archivedAt: null }, select: { id: true } })
    const realStudent = await newStudent()

    // With DEMO_ISOLATION off (test default), everyone sees both demo and real listings, properly flagged.
    const unfiltered = await caller.kos.list()
    expect(unfiltered.find((k) => k.id === demoKos.id)?.isDemoListing).toBe(true)
    expect(unfiltered.find((k) => k.id === realKos.id)?.isDemoListing).toBe(false)

    // Turn DEMO_ISOLATION on.
    process.env.DEMO_ISOLATION = '1'

    // Anonymous viewer: demo listings excluded from list and search.
    const anonList = await caller.kos.list()
    expect(anonList.some((k) => k.isDemoListing)).toBe(false)
    expect(anonList.some((k) => k.id === demoKos.id)).toBe(false)
    expect(anonList.some((k) => k.id === realKos.id)).toBe(true)

    const anonSearch = await caller.kos.search({})
    expect(anonSearch.some((k) => k.isDemoListing)).toBe(false)
    expect(anonSearch.some((k) => k.id === demoKos.id)).toBe(false)

    // Real signed-in student: demo listings excluded from list and search.
    const realList = await callerFor(realStudent.id).kos.list()
    expect(realList.some((k) => k.isDemoListing)).toBe(false)
    expect(realList.some((k) => k.id === demoKos.id)).toBe(false)

    const realSearch = await callerFor(realStudent.id).kos.search({})
    expect(realSearch.some((k) => k.isDemoListing)).toBe(false)

    // Demo viewer: sees everything, with accurate flags (even if callerFor omits options.isDemo, DB is checked).
    const demoList = await callerFor(DEMO_STUDENT_ID).kos.list()
    expect(demoList.find((k) => k.id === demoKos.id)?.isDemoListing).toBe(true)
    expect(demoList.find((k) => k.id === realKos.id)?.isDemoListing).toBe(false)

    const demoSearch = await callerFor(DEMO_STUDENT_ID).kos.search({})
    expect(demoSearch.find((k) => k.id === demoKos.id)?.isDemoListing).toBe(true)
    expect(demoSearch.find((k) => k.id === realKos.id)?.isDemoListing).toBe(false)

    // Direct kos.detail for a demo listing still returns it flagged for anonymous and real viewers.
    const anonDetail = await caller.kos.detail({ id: demoKos.id })
    expect(anonDetail.id).toBe(demoKos.id)
    expect(anonDetail.isDemoListing).toBe(true)

    const realDetail = await callerFor(realStudent.id).kos.detail({ id: demoKos.id })
    expect(realDetail.isDemoListing).toBe(true)

    const realKosDetail = await caller.kos.detail({ id: realKos.id })
    expect(realKosDetail.isDemoListing).toBe(false)
  })
})

describe('[SIM-010] roommate shortlist shareable room', () => {
  const LAT = -6.2017
  const LNG = 106.7819
  let pseq = 0

  async function makePair() {
    const makePerson = async () => {
      const u = await newStudent()
      await verifyAtCampus(u.id)
      const c = callerFor(u.id).matching
      await c.profile.upsert({
        displayName: `ShortlistTester ${++pseq}`,
        gender: 'PEREMPUAN',
        birthYear: 2004,
        budgetMin: 1_000_000,
        budgetMax: 2_500_000,
        anchorLat: LAT,
        anchorLng: LNG,
        anchorLabel: 'BINUS Anggrek',
        moveInDate: startIn(30),
        smoking: 'TIDAK_MEROKOK_TOLERAN',
      })
      return { id: u.id, c }
    }
    const a = await makePerson()
    const b = await makePerson()
    const req = await prisma.partnerRequest.create({
      data: { fromUserId: a.id, toUserId: b.id, status: 'ACCEPTED', expiresAt: new Date(Date.now() + 14 * 86_400_000) },
    })
    const [lo, hi] = [a.id, b.id].sort() as [string, string]
    const conn = await prisma.partnerConnection.create({ data: { userAId: lo, userBId: hi, requestId: req.id } })
    return { a, b, conn }
  }

  it('returns shareable: null for a single-room kos and picks the cheapest vacant maxOccupants >= 2 room for a mixed kos', async () => {
    const { a, conn } = await makePair()
    const owner = await newOwner()

    const singleOnly = await prisma.kos.create({
      data: {
        slug: `sim010-single-${Date.now()}`,
        name: 'Kos Single Only',
        gender: 'CAMPUR',
        address: 'Jl. Single',
        district: 'Kemanggisan',
        city: 'Jakarta',
        lat: LAT,
        lng: LNG,
        electricityType: 'INCLUDED',
        ownerId: owner.ownerId,
        rooms: {
          create: [
            { roomNumber: 'S1', floor: 1, type: 'Standar', size: '3x3', bedType: 'Single', priceMonthly: 1_500_000, maxOccupants: 1, occupancy: 'VACANT' },
            // Occupied shareable room must not be returned.
            { roomNumber: 'S2', floor: 1, type: 'Berdua', size: '4x4', bedType: 'Twin', priceMonthly: 2_400_000, maxOccupants: 2, occupancy: 'OCCUPIED' },
          ],
        },
      },
    })

    const mixed = await prisma.kos.create({
      data: {
        slug: `sim010-mixed-${Date.now()}`,
        name: 'Kos Mixed',
        gender: 'CAMPUR',
        address: 'Jl. Mixed',
        district: 'Kemanggisan',
        city: 'Jakarta',
        lat: LAT,
        lng: LNG,
        electricityType: 'INCLUDED',
        ownerId: owner.ownerId,
        rooms: {
          create: [
            { roomNumber: 'M1', floor: 1, type: 'Standar', size: '3x3', bedType: 'Single', priceMonthly: 1_800_000, maxOccupants: 1, occupancy: 'VACANT' },
            { roomNumber: 'M2', floor: 1, type: 'Deluxe Berdua', size: '4x4', bedType: 'Twin', priceMonthly: 3_000_000, maxOccupants: 2, pricePerPersonMonthly: null, occupancy: 'VACANT' },
            { roomNumber: 'M3', floor: 2, type: 'Twin Hemat', size: '4x4', bedType: 'Twin', priceMonthly: 2_800_000, maxOccupants: 2, pricePerPersonMonthly: 1_300_000, occupancy: 'VACANT' },
          ],
        },
      },
      include: { rooms: true },
    })
    const m3 = mixed.rooms.find((r) => r.roomNumber === 'M3')!

    await a.c.shortlist.add({ connectionId: conn.id, kosId: singleOnly.id })
    await a.c.shortlist.add({ connectionId: conn.id, kosId: mixed.id })

    const entries = await a.c.shortlist.list({ connectionId: conn.id })
    const singleEntry = entries.find((e) => e.kosId === singleOnly.id)!
    const mixedEntry = entries.find((e) => e.kosId === mixed.id)!

    expect(singleEntry.priceFrom).toBe(1_500_000)
    expect(singleEntry.shareable).toBeNull()

    // M3 pair cost = 1_300_000 * 2 = 2_600_000 < M2 (3_000_000); M1 is single (1_800_000) so priceFrom stays 1_800_000.
    expect(mixedEntry.priceFrom).toBe(1_800_000)
    expect(mixedEntry.shareable).toEqual({
      roomId: m3.id,
      type: 'Twin Hemat',
      pricePerPerson: 1_300_000,
      priceMonthly: 2_800_000,
      maxOccupants: 2,
    })
  })
})
