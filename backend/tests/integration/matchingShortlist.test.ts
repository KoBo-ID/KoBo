import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, newStudent, prisma } from '../helpers.ts'
import { err, newOwner, startIn, verifyAtCampus } from './gap-helpers.ts'

const DAY = 86_400_000
const LAT = -6.2017
const LNG = 106.7819

beforeEach(async () => {
  await resetDb(prisma)
  // The seed has a demo chat and requests; these tests count rows globally, so start from empty matching tables.
  await prisma.partnerMessage.deleteMany()
  await prisma.connectionReadState.deleteMany()
  await prisma.sharedShortlistItem.deleteMany()
  await prisma.userReport.deleteMany()
  await prisma.userBlock.deleteMany()
  await prisma.partnerConnection.deleteMany()
  await prisma.partnerRequest.deleteMany()
  await prisma.matchingProfile.deleteMany()
})

let seq = 0
async function person(over: Record<string, unknown> = {}) {
  const u = await newStudent()
  await verifyAtCampus(u.id)
  const c = callerFor(u.id).matching
  const p = await c.profile.upsert({
    displayName: `Teman ${++seq}`,
    gender: 'PEREMPUAN',
    birthYear: 2004,
    budgetMin: 1_000_000,
    budgetMax: 2_000_000,
    anchorLat: LAT,
    anchorLng: LNG,
    anchorLabel: 'BINUS Anggrek',
    moveInDate: startIn(30),
    smoking: 'TIDAK_MEROKOK_TOLERAN',
    ...over,
  })
  return { id: u.id, profileId: p.id, c }
}

async function pair(over: Record<string, unknown> = {}) {
  const a = await person(over)
  const b = await person(over)
  const req = await prisma.partnerRequest.create({ data: { fromUserId: a.id, toUserId: b.id, status: 'ACCEPTED', expiresAt: new Date(Date.now() + 14 * DAY) } })
  const [lo, hi] = [a.id, b.id].sort() as [string, string]
  const conn = await prisma.partnerConnection.create({ data: { userAId: lo, userBId: hi, requestId: req.id } })
  return { a, b, conn }
}

let kseq = 0
async function kos(ownerId: string, rooms: { price: number; max?: number; perPerson?: number; occupancy?: 'VACANT' | 'OCCUPIED' }[], over: Record<string, unknown> = {}) {
  const n = ++kseq
  return prisma.kos.create({
    data: {
      slug: `sl-${Date.now()}-${n}`,
      name: `Kos Sl ${n}`,
      gender: 'CAMPUR',
      address: 'Jl. Sl',
      district: 'Kebayoran',
      city: 'Jakarta',
      lat: LAT + 0.002,
      lng: LNG,
      electricityType: 'INCLUDED',
      ownerId,
      ...over,
      rooms: {
        create: rooms.map((r, i) => ({
          roomNumber: `R${i}`,
          floor: 1,
          type: 'Standar',
          size: '3 x 3 m',
          bedType: 'Double',
          priceMonthly: r.price,
          maxOccupants: r.max ?? 1,
          pricePerPersonMonthly: r.perPerson ?? null,
          occupancy: r.occupancy ?? 'VACANT',
        })),
      },
    },
  })
}

describe('shortlist: access and freeze', () => {
  it('a non-participant gets NOT_FOUND', async () => {
    const { conn } = await pair()
    const o = await newOwner()
    const k = await kos(o.ownerId, [{ price: 1_000_000 }])
    const x = await person()
    for (const p of [
      () => x.c.shortlist.list({ connectionId: conn.id }),
      () => x.c.shortlist.add({ connectionId: conn.id, kosId: k.id }),
      () => x.c.shortlist.remove({ connectionId: conn.id, kosId: k.id }),
      () => x.c.shortlist.kosCandidates({ connectionId: conn.id }),
      () => x.c.shortlist.applicationNoteFor({ connectionId: conn.id }),
    ]) {
      expect((await err(p()))?.code).toBe('NOT_FOUND')
    }
    expect(await prisma.sharedShortlistItem.count()).toBe(0)
  })

  it('adds once, labels who added, removes, and freezes after the connection ends', async () => {
    const { a, b, conn } = await pair()
    const o = await newOwner()
    const k = await kos(o.ownerId, [{ price: 1_200_000 }, { price: 900_000 }])
    await a.c.shortlist.add({ connectionId: conn.id, kosId: k.id })
    expect((await err(b.c.shortlist.add({ connectionId: conn.id, kosId: k.id })))?.code).toBe('CONFLICT')

    const forA = await a.c.shortlist.list({ connectionId: conn.id })
    const forB = await b.c.shortlist.list({ connectionId: conn.id })
    expect(forA).toHaveLength(1)
    expect(forA[0]).toMatchObject({ kosId: k.id, addedByMe: true, addedBy: 'Kamu', priceFrom: 900_000 })
    const aName = (await prisma.matchingProfile.findUniqueOrThrow({ where: { id: a.profileId } })).displayName
    expect(forB[0]).toMatchObject({ addedByMe: false, addedBy: aName })
    expect(JSON.stringify([forA, forB])).not.toContain(a.id)

    expect((await b.c.shortlist.applicationNoteFor({ connectionId: conn.id })).note).toBe(`Calon teman sekamar: ${aName}`)

    await prisma.partnerConnection.update({ where: { id: conn.id }, data: { endedAt: new Date(), endReason: 'SELESAI' } })
    expect((await err(a.c.shortlist.remove({ connectionId: conn.id, kosId: k.id })))?.code).toBe('FORBIDDEN')
    const k2 = await kos(o.ownerId, [{ price: 1_000_000 }])
    expect((await err(a.c.shortlist.add({ connectionId: conn.id, kosId: k2.id })))?.code).toBe('FORBIDDEN')
    expect(await a.c.shortlist.list({ connectionId: conn.id })).toHaveLength(1)
  })

  it('removes on a live connection and says NOT_FOUND for a kos not in the list', async () => {
    const { a, conn } = await pair()
    const o = await newOwner()
    const k = await kos(o.ownerId, [{ price: 1_000_000 }])
    expect((await err(a.c.shortlist.remove({ connectionId: conn.id, kosId: k.id })))?.code).toBe('NOT_FOUND')
    await a.c.shortlist.add({ connectionId: conn.id, kosId: k.id })
    await a.c.shortlist.remove({ connectionId: conn.id, kosId: k.id })
    expect(await a.c.shortlist.list({ connectionId: conn.id })).toHaveLength(0)
  })

  it('accepts only public kos: unapproved owner or archived kos is NOT_FOUND', async () => {
    const { a, conn } = await pair()
    const o = await newOwner()
    const pending = await newOwner()
    await prisma.ownerProfile.update({ where: { id: pending.ownerId }, data: { verificationStatus: 'BELUM_KIRIM' } })
    const hidden = await kos(pending.ownerId, [{ price: 1_000_000 }])
    const archived = await kos(o.ownerId, [{ price: 1_000_000 }], { archivedAt: new Date() })
    const ok = await kos(o.ownerId, [{ price: 1_000_000 }])
    expect((await err(a.c.shortlist.add({ connectionId: conn.id, kosId: hidden.id })))?.code).toBe('NOT_FOUND')
    expect((await err(a.c.shortlist.add({ connectionId: conn.id, kosId: archived.id })))?.code).toBe('NOT_FOUND')
    await a.c.shortlist.add({ connectionId: conn.id, kosId: ok.id })
  })
})

describe('shortlist: kosCandidates', () => {
  it('labels capacity honestly, compares per person x2, and respects budget, gender and distance', async () => {
    const { a, conn } = await pair() // combined budget 4_000_000
    const o = await newOwner()
    const shareRoom = await kos(o.ownerId, [{ price: 3_500_000, max: 2 }]) // per room, fits
    const perPerson = await kos(o.ownerId, [{ price: 9_000_000, max: 2, perPerson: 1_800_000 }]) // 2 x 1.8M = 3.6M fits
    const perPersonTooMuch = await kos(o.ownerId, [{ price: 2_000_000, max: 2, perPerson: 2_500_000 }]) // 5M, no
    const unknown = await kos(o.ownerId, [{ price: 1_500_000 }]) // capacity unknown
    const tooPricey = await kos(o.ownerId, [{ price: 4_500_000, max: 2 }])
    const male = await kos(o.ownerId, [{ price: 1_000_000, max: 2 }], { gender: 'PUTRA' })
    const female = await kos(o.ownerId, [{ price: 1_000_000, max: 2 }], { gender: 'PUTRI' })
    const far = await kos(o.ownerId, [{ price: 1_000_000, max: 2 }], { lat: LAT + 0.5 })
    const occupied = await kos(o.ownerId, [{ price: 1_000_000, max: 2, occupancy: 'OCCUPIED' }])
    const archived = await kos(o.ownerId, [{ price: 1_000_000, max: 2 }], { archivedAt: new Date() })

    const res = await a.c.shortlist.kosCandidates({ connectionId: conn.id })
    const byId = new Map(res.map((r) => [r.kosId, r]))
    expect(byId.get(shareRoom.id)).toMatchObject({ status: 'SHAREABLE', price: 3_500_000, priceUnit: 'PER_KAMAR', roomsFitting: 1, inShortlist: false })
    expect(byId.get(perPerson.id)).toMatchObject({ status: 'SHAREABLE', price: 1_800_000, priceUnit: 'PER_ORANG' })
    expect(byId.get(unknown.id)).toMatchObject({ status: 'ASK_OWNER', price: 1_500_000, priceUnit: 'PER_KAMAR' })
    expect(byId.get(female.id)?.status).toBe('SHAREABLE')
    for (const bad of [perPersonTooMuch, tooPricey, male, far, occupied, archived]) expect(byId.has(bad.id)).toBe(false)
    // Shareable kos come before "ask the owner".
    const firstAsk = res.findIndex((r) => r.status === 'ASK_OWNER')
    expect(res.slice(firstAsk).every((r) => r.status === 'ASK_OWNER')).toBe(true)

    await a.c.shortlist.add({ connectionId: conn.id, kosId: shareRoom.id })
    const again = await a.c.shortlist.kosCandidates({ connectionId: conn.id })
    expect(again.find((r) => r.kosId === shareRoom.id)?.inShortlist).toBe(true)
  })

  it('a male pair sees PUTRA and CAMPUR but not PUTRI, and results are capped at 30', async () => {
    const { a, conn } = await pair({ gender: 'LAKI_LAKI' })
    const o = await newOwner()
    const putra = await kos(o.ownerId, [{ price: 1_000_000, max: 2 }], { gender: 'PUTRA' })
    const putri = await kos(o.ownerId, [{ price: 1_000_000, max: 2 }], { gender: 'PUTRI' })
    const ids = (await a.c.shortlist.kosCandidates({ connectionId: conn.id })).map((r) => r.kosId)
    expect(ids).toContain(putra.id)
    expect(ids).not.toContain(putri.id)
    for (let i = 0; i < 32; i++) await kos(o.ownerId, [{ price: 1_000_000, max: 2 }])
    expect(await a.c.shortlist.kosCandidates({ connectionId: conn.id })).toHaveLength(30)
  })
})
