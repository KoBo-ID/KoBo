import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_TEMAN_CONNECTION_ID } from '../../src/demo.ts'
import { resetDemo } from '../../src/demoReset.ts'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, DEMO_STUDENT_ID, DEMO_TEMAN_A_ID, DEMO_TEMAN_B_ID, prisma } from '../helpers.ts'
import { err, makeKos, roomInput } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

describe('room occupancy (owner.room.create / update)', () => {
  it('defaults to one person and no per-person price', async () => {
    const { kos, owner } = await makeKos([])
    const { id } = await owner.room.create(roomInput({ kosId: kos.id }) as never)
    expect(await prisma.room.findUniqueOrThrow({ where: { id } })).toMatchObject({ maxOccupants: 1, pricePerPersonMonthly: null })
  })

  it('stores maxOccupants and a per-person price for a shared room', async () => {
    const { kos, owner } = await makeKos([])
    const { id } = await owner.room.create(roomInput({ kosId: kos.id, maxOccupants: 2, pricePerPersonMonthly: 700_000 }) as never)
    expect(await prisma.room.findUniqueOrThrow({ where: { id } })).toMatchObject({ maxOccupants: 2, pricePerPersonMonthly: 700_000 })
  })

  it('refuses a per-person price on a one-person room (create, explicit 1, and update)', async () => {
    const { kos, owner } = await makeKos([{ n: 'A1', type: 'Standar' }])
    const bad = await err(owner.room.create(roomInput({ kosId: kos.id, pricePerPersonMonthly: 500_000 }) as never))
    expect(bad?.code).toBe('BAD_REQUEST')
    expect(bad?.message).toContain('Harga per orang')
    expect((await err(owner.room.create(roomInput({ kosId: kos.id, roomNumber: 'G98', maxOccupants: 1, pricePerPersonMonthly: 500_000 }) as never)))?.code).toBe('BAD_REQUEST')
    const room = await prisma.room.findFirstOrThrow({ where: { kosId: kos.id } })
    const upd = (over: Record<string, unknown>) => owner.room.update({ ...roomInput({ roomNumber: room.roomNumber }), kosId: kos.id, roomId: room.id, ...over } as never)
    expect((await err(upd({ pricePerPersonMonthly: 500_000 })))?.code).toBe('BAD_REQUEST')
    expect(await prisma.room.count({ where: { kosId: kos.id } })).toBe(1)
  })

  it('update checks the stored capacity when maxOccupants is omitted, and keeps both when neither is sent', async () => {
    const { kos, owner } = await makeKos([])
    const { id } = await owner.room.create(roomInput({ kosId: kos.id, maxOccupants: 3, pricePerPersonMonthly: 600_000 }) as never)
    const base = { ...roomInput(), kosId: kos.id, roomId: id }
    await owner.room.update({ ...base, priceMonthly: 1_900_000 } as never)
    expect(await prisma.room.findUniqueOrThrow({ where: { id } })).toMatchObject({ maxOccupants: 3, pricePerPersonMonthly: 600_000, priceMonthly: 1_900_000 })
    await owner.room.update({ ...base, pricePerPersonMonthly: null } as never)
    expect((await prisma.room.findUniqueOrThrow({ where: { id } })).pricePerPersonMonthly).toBeNull()
    await owner.room.update({ ...base, maxOccupants: 1 } as never)
    // Now one person: a per-person price can no longer be set without raising the capacity.
    expect((await err(owner.room.update({ ...base, pricePerPersonMonthly: 400_000 } as never)))?.code).toBe('BAD_REQUEST')
    await owner.room.update({ ...base, maxOccupants: 2, pricePerPersonMonthly: 400_000 } as never)
    expect(await prisma.room.findUniqueOrThrow({ where: { id } })).toMatchObject({ maxOccupants: 2, pricePerPersonMonthly: 400_000 })
  })

  it('shrinking a shared room to one person clears its per-person price', async () => {
    const { kos, owner } = await makeKos([])
    const { id } = await owner.room.create(roomInput({ kosId: kos.id, maxOccupants: 2, pricePerPersonMonthly: 700_000 }) as never)
    await owner.room.update({ ...roomInput(), kosId: kos.id, roomId: id, maxOccupants: 1 } as never)
    expect(await prisma.room.findUniqueOrThrow({ where: { id } })).toMatchObject({ maxOccupants: 1, pricePerPersonMonthly: null })
  })

  it('rejects out-of-range values', async () => {
    const { kos, owner } = await makeKos([])
    for (const over of [{ maxOccupants: 0 }, { maxOccupants: 5 }, { maxOccupants: 2, pricePerPersonMonthly: 0 }]) {
      expect((await err(owner.room.create(roomInput({ kosId: kos.id, ...over }) as never)))?.code).toBe('BAD_REQUEST')
    }
  })

  it('an unknown room still reads NOT_FOUND on update', async () => {
    const { kos, owner } = await makeKos([])
    expect((await err(owner.room.update({ ...roomInput(), kosId: kos.id, roomId: 'nope', maxOccupants: 2 } as never)))?.code).toBe('NOT_FOUND')
  })
})

describe('matching seed and demo reset', () => {
  const state = async () => ({
    profiles: await prisma.matchingProfile.count(),
    requests: await prisma.partnerRequest.count(),
    connections: await prisma.partnerConnection.count(),
    messages: await prisma.partnerMessage.count(),
    readStates: await prisma.connectionReadState.count(),
    shortlist: await prisma.sharedShortlistItem.count(),
  })

  it('seeds profiles, one pending request and one live connection with messages for the demo student', async () => {
    const s = await state()
    expect(s.profiles).toBeGreaterThanOrEqual(8)
    const profile = await prisma.matchingProfile.findUniqueOrThrow({ where: { userId: DEMO_STUDENT_ID } })
    expect(profile).toMatchObject({ active: true, hiddenByReportsAt: null })
    const pending = await prisma.partnerRequest.findMany({ where: { toUserId: DEMO_STUDENT_ID, status: 'PENDING' }, include: { from: true } })
    expect(pending).toHaveLength(1)
    expect(pending[0]!.from.isDemo).toBe(false)
    const conns = await prisma.partnerConnection.findMany({ where: { OR: [{ userAId: DEMO_STUDENT_ID }, { userBId: DEMO_STUDENT_ID }], endedAt: null }, include: { messages: true } })
    expect(conns).toHaveLength(1)
    expect(conns[0]!.messages.length).toBeGreaterThanOrEqual(3)
    expect(conns[0]!.userAId < conns[0]!.userBId).toBe(true)
    // Every seeded profile belongs to a verified student.
    expect(await prisma.matchingProfile.count({ where: { user: { campusEmailVerifiedAt: null, isDemo: false } } })).toBe(0)
  })

  it('seeds the two Teman Sekamar demo accounts pre-connected with chat and a shared shortlist', async () => {
    const [pA, pB] = await Promise.all([
      prisma.matchingProfile.findUniqueOrThrow({ where: { userId: DEMO_TEMAN_A_ID } }),
      prisma.matchingProfile.findUniqueOrThrow({ where: { userId: DEMO_TEMAN_B_ID } }),
    ])
    expect(pA).toMatchObject({ active: true, gender: 'PEREMPUAN', roomShare: 2, hiddenByReportsAt: null })
    expect(pB).toMatchObject({ active: true, gender: 'PEREMPUAN', roomShare: 2, hiddenByReportsAt: null })

    const conn = await prisma.partnerConnection.findUniqueOrThrow({
      where: { id: DEMO_TEMAN_CONNECTION_ID },
      include: { messages: true, shortlist: true },
    })
    expect(conn.endedAt).toBeNull()
    expect(conn.userAId < conn.userBId).toBe(true)
    expect([conn.userAId, conn.userBId].sort()).toEqual([DEMO_TEMAN_A_ID, DEMO_TEMAN_B_ID].sort())
    expect(conn.messages.length).toBeGreaterThanOrEqual(4)
    expect(conn.shortlist.map((s) => s.kosId)).toEqual(['kos-2'])

    const nadia = callerFor(DEMO_TEMAN_A_ID, { isDemo: true })
    const clara = callerFor(DEMO_TEMAN_B_ID, { isDemo: true })
    const candidates = await nadia.matching.shortlist.kosCandidates({ connectionId: DEMO_TEMAN_CONNECTION_ID })
    expect(candidates.some((c) => c.kosId === 'kos-1' && c.status === 'SHAREABLE' && !c.inShortlist)).toBe(true)
    expect(candidates.some((c) => c.kosId === 'kos-2' && c.inShortlist)).toBe(true)
    const note = await clara.matching.shortlist.applicationNoteFor({ connectionId: DEMO_TEMAN_CONNECTION_ID })
    expect(note.note).toContain('Nadia')
  })

  it('resetDb is repeatable: junk matching rows are gone and the seeded set is identical', async () => {
    const before = await state()
    const other = await prisma.matchingProfile.findFirstOrThrow({ where: { userId: { not: DEMO_STUDENT_ID } } })
    await prisma.partnerRequest.create({ data: { fromUserId: DEMO_STUDENT_ID, toUserId: other.userId, expiresAt: new Date(Date.now() + 86_400_000), status: 'DECLINED' } })
    await resetDb(prisma)
    expect(await state()).toEqual(before)
  })

  it('the demo student sees candidates in discover', async () => {
    const res = await callerFor(DEMO_STUDENT_ID).matching.discover({} as never)
    expect(res.items.length).toBeGreaterThan(0)
  })

  it('seeds shareable rooms in BINUS-area kos, some with a per-person price', async () => {
    const rooms = await prisma.room.findMany({ where: { maxOccupants: { gte: 2 }, kos: { nearestCampusId: { startsWith: 'binus-' } } } })
    expect(rooms.length).toBeGreaterThan(0)
    expect(rooms.some((r) => r.pricePerPersonMonthly != null)).toBe(true)
    expect(rooms.some((r) => r.pricePerPersonMonthly == null)).toBe(true)
  })

  it('resetDemo restores all demo student matching and shortlist rows and leaves other students alone', async () => {
    const before = await state()
    await prisma.sharedShortlistItem.deleteMany({})
    await prisma.partnerMessage.deleteMany({})
    await prisma.partnerConnection.deleteMany({})
    await prisma.partnerRequest.deleteMany({})
    await prisma.matchingProfile.update({ where: { userId: DEMO_STUDENT_ID }, data: { active: false, intro: 'vandal' } })
    await prisma.matchingProfile.update({ where: { userId: DEMO_TEMAN_A_ID }, data: { active: false, intro: 'vandal-a' } })
    const bystander = await prisma.matchingProfile.findFirstOrThrow({ where: { user: { isDemo: false } } })
    await prisma.matchingProfile.update({ where: { id: bystander.id }, data: { intro: 'edit sah' } })
    await resetDemo(prisma)
    expect(await state()).toEqual(before)
    expect(await prisma.matchingProfile.findUniqueOrThrow({ where: { userId: DEMO_STUDENT_ID } })).toMatchObject({ active: true })
    expect(await prisma.matchingProfile.findUniqueOrThrow({ where: { userId: DEMO_TEMAN_A_ID } })).toMatchObject({ active: true })
    expect((await prisma.matchingProfile.findUniqueOrThrow({ where: { id: bystander.id } })).intro).toBe('edit sah')
    // Running it twice is harmless.
    await resetDemo(prisma)
    expect(await state()).toEqual(before)
  })
})
