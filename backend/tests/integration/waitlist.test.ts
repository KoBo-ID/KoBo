import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_EMAILS } from '../../src/demo.ts'
import { resetDemo } from '../../src/demoReset.ts'
import { resetDb } from '../../src/db/seed.ts'
import { renderEmail } from '../../src/emailTemplates.ts'
import { advanceAllWaitlists } from '../../src/waitlist.ts'
import { callerFor, newStudent, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const code = async (p: Promise<unknown>) => (await err(p))?.code
const startDate = () => addDays(todayWIB(new Date()), 3)
const HOUR = 3600_000

let kosSeq = 0
/** A fresh kos with the given rooms ({ n: room number, type }), all vacant. Owned by the first non-demo owner (demo accounts cannot delete kos). */
async function makeKos(rooms: { n: string; type: string }[]) {
  const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { user: { isDemo: false } }, orderBy: { id: 'asc' } })
  const seq = ++kosSeq
  const kos = await prisma.kos.create({
    data: {
      slug: `antre-${seq}`,
      name: `Kos Antre ${seq}`,
      gender: 'CAMPUR',
      address: 'Jl. Antre',
      district: 'Kebayoran',
      city: 'Jakarta',
      lat: -6.2,
      lng: 106.8,
      electricityType: 'INCLUDED',
      ownerId: owner.id,
      rooms: { create: rooms.map((r) => ({ roomNumber: r.n, floor: 1, type: r.type, size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 1_500_000 })) },
    },
    include: { rooms: true },
  })
  const byNumber = Object.fromEntries(kos.rooms.map((r) => [r.roomNumber, r]))
  return { kos, owner: callerFor(owner.userId).owner, ownerUserId: owner.userId, room: (n: string) => byNumber[n] }
}

/** A kos with a Standar room (S1) and a Deluxe room (D1), both occupied by an ACTIVE tenancy. */
async function fullKos(rooms = [{ n: 'S1', type: 'Standar' }, { n: 'D1', type: 'Deluxe' }]) {
  const k = await makeKos(rooms)
  const tenancies: Record<string, string> = {}
  for (const r of k.kos.rooms) tenancies[r.roomNumber] = await occupy(r.id)
  return { ...k, tenancies }
}

async function occupy(roomId: string) {
  const tenant = await newStudent()
  const t = await prisma.tenancy.create({ data: { roomId, userId: tenant.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 } })
  await prisma.room.update({ where: { id: roomId }, data: { occupancy: 'OCCUPIED' } })
  return t.id
}

/** Joined in order, with distinct createdAt so the queue order is unambiguous. */
async function join(kosId: string, roomType: string | null = null) {
  const s = await newStudent()
  const entry = await callerFor(s.id).waitlist.join({ kosId, roomType })
  return { s, c: callerFor(s.id), entry }
}

const entryRow = (id: string) => prisma.waitlistEntry.findUniqueOrThrow({ where: { id } })

describe('waitlist.join', () => {
  it('is refused while a matching bookable room exists', async () => {
    const k = await makeKos([{ n: 'S1', type: 'Standar' }])
    const s = await newStudent()
    const c = callerFor(s.id)
    const e = await err(c.waitlist.join({ kosId: k.kos.id, roomType: null }))
    expect(e?.code).toBe('BAD_REQUEST')
    expect(e?.message).toBe('Masih ada kamar kosong, silakan langsung pesan.')
    expect(await code(c.waitlist.join({ kosId: k.kos.id, roomType: 'Standar' }))).toBe('BAD_REQUEST')
  })

  it('succeeds when the kos is full, and when only other types are free', async () => {
    const full = await fullKos()
    const a = await join(full.kos.id)
    expect(a.entry).toMatchObject({ status: 'WAITING', position: 1, roomType: null, kos: { id: full.kos.id }, offer: null })

    const mixed = await makeKos([{ n: 'S1', type: 'Standar' }, { n: 'D1', type: 'Deluxe' }])
    await occupy(mixed.room('D1').id)
    const b = await join(mixed.kos.id, 'Deluxe')
    expect(b.entry.status).toBe('WAITING')
    // The free Standar room still blocks "any type" and "Standar".
    const s = await newStudent()
    expect(await code(callerFor(s.id).waitlist.join({ kosId: mixed.kos.id, roomType: 'Standar' }))).toBe('BAD_REQUEST')
    expect(await code(callerFor(s.id).waitlist.join({ kosId: mixed.kos.id, roomType: null }))).toBe('BAD_REQUEST')
  })

  it('requires a signed-in user', async () => {
    const full = await fullKos()
    const { caller } = await import('../helpers.ts')
    expect(await code(caller.waitlist.join({ kosId: full.kos.id, roomType: null }))).toBe('UNAUTHORIZED')
  })

  it('rejects a duplicate live entry for the same kos with CONFLICT', async () => {
    const full = await fullKos()
    const a = await join(full.kos.id)
    const e = await err(a.c.waitlist.join({ kosId: full.kos.id, roomType: 'Deluxe' }))
    expect(e?.code).toBe('CONFLICT')
    expect(e?.message).toBe('Kamu sudah ada di daftar tunggu kos ini.')
  })

  it('rejects a sixth live entry across kos', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    for (let i = 0; i < 5; i++) {
      const k = await fullKos([{ n: 'S1', type: 'Standar' }])
      await c.waitlist.join({ kosId: k.kos.id, roomType: null })
    }
    const sixth = await fullKos([{ n: 'S1', type: 'Standar' }])
    expect(await code(c.waitlist.join({ kosId: sixth.kos.id, roomType: null }))).toBe('BAD_REQUEST')
  })

  it("forbids the kos's own owner", async () => {
    const full = await fullKos()
    expect(await code(callerFor(full.ownerUserId).waitlist.join({ kosId: full.kos.id, roomType: null }))).toBe('FORBIDDEN')
  })

  it('rejects a room type the kos does not have, and an unknown kos', async () => {
    const full = await fullKos()
    const s = await newStudent()
    expect(await code(callerFor(s.id).waitlist.join({ kosId: full.kos.id, roomType: 'Suite' }))).toBe('BAD_REQUEST')
    expect(await code(callerFor(s.id).waitlist.join({ kosId: 'kos-tidak-ada', roomType: null }))).toBe('NOT_FOUND')
  })

  it('lets a student with an ACTIVE tenancy elsewhere join', async () => {
    const full = await fullKos()
    const tenantId = (await prisma.tenancy.findUniqueOrThrow({ where: { id: full.tenancies.S1 } })).userId
    const other = await fullKos()
    expect((await callerFor(tenantId).waitlist.join({ kosId: other.kos.id, roomType: null })).status).toBe('WAITING')
  })
})

describe('queue positions', () => {
  it('counts only earlier competing entries (mixed any / typed queue)', async () => {
    const f = await fullKos()
    const a = await join(f.kos.id, 'Deluxe')
    const b = await join(f.kos.id, 'Standar')
    const c = await join(f.kos.id, null)
    const d = await join(f.kos.id, 'Deluxe')
    expect([a, b, c, d].map((x) => x.entry.position)).toEqual([1, 1, 3, 3])
    const status = await callerFor(d.s.id).waitlist.status({ kosId: f.kos.id })
    expect(status.mine).toMatchObject({ id: d.entry.id, position: 3 })
    expect(status.full).toBe(true)
    expect(status.types).toEqual([
      { roomType: 'Deluxe', waiting: 3 },
      { roomType: 'Standar', waiting: 2 },
    ])
  })

  it('goes down after a leave, an offer and an owner removal', async () => {
    const f = await fullKos([{ n: 'S1', type: 'Standar' }])
    const a = await join(f.kos.id)
    const b = await join(f.kos.id)
    const c = await join(f.kos.id)
    const d = await join(f.kos.id)
    const pos = async (x: typeof a) => (await x.c.waitlist.mine())[0].position
    expect(await pos(d)).toBe(4)
    await a.c.waitlist.leave({ entryId: a.entry.id })
    expect(await pos(d)).toBe(3)
    await f.owner.waitlist.remove({ kosId: f.kos.id, entryId: b.entry.id })
    expect(await pos(d)).toBe(2)
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 }) // offers S1 to c
    expect((await c.c.waitlist.mine())[0]).toMatchObject({ status: 'OFFERED', position: null })
    expect(await pos(d)).toBe(1)
  })

  it('a signed-out visitor sees the queue without a personal entry', async () => {
    const f = await fullKos()
    await join(f.kos.id)
    const { caller } = await import('../helpers.ts')
    const s = await caller.waitlist.status({ kosId: f.kos.id })
    expect(s.mine).toBeNull()
    expect(s.types.every((t) => t.waiting === 1)).toBe(true)
  })
})

describe('releasing a room', () => {
  it('ending a tenancy offers the room to #1, queues the email and leaves #2 waiting', async () => {
    const f = await fullKos([{ n: 'S1', type: 'Standar' }])
    const a = await join(f.kos.id)
    const b = await join(f.kos.id)
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    const first = await entryRow(a.entry.id)
    expect(first).toMatchObject({ status: 'OFFERED', offeredRoomId: f.room('S1').id })
    expect(first.offerExpiresAt!.getTime() - Date.now()).toBeGreaterThan(23 * HOUR)
    expect((await entryRow(b.entry.id)).status).toBe('WAITING')

    const mails = await prisma.emailOutbox.findMany({ where: { template: 'waitlist-offer' } })
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toBe(a.s.email)
    expect(mails[0].payload).toMatchObject({ kosName: f.kos.name, roomNumber: 'S1', url: expect.stringContaining(`/kos/${f.kos.id}`) })
    const rendered = renderEmail('waitlist-offer', mails[0].payload)
    expect(rendered?.subject).toBe(`Kamar di ${f.kos.name} tersedia untukmu`)
    expect(rendered?.text).toContain('WIB')
    expect(rendered?.text).toContain('S1')
  })

  it('the offered student sees the offer in waitlist.mine and kos.detail marks the room', async () => {
    const f = await fullKos([{ n: 'S1', type: 'Standar' }])
    const a = await join(f.kos.id)
    const b = await join(f.kos.id)
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    const mine = (await a.c.waitlist.mine())[0]
    expect(mine.offer).toMatchObject({ roomId: f.room('S1').id, roomNumber: 'S1', priceMonthly: 1_500_000 })
    const asA = await a.c.kos.detail({ id: f.kos.id })
    expect(asA.rooms[0]).toMatchObject({ reservedForWaitlist: false, offeredToMe: true })
    const asB = await b.c.kos.detail({ id: f.kos.id })
    expect(asB.rooms[0]).toMatchObject({ reservedForWaitlist: true, offeredToMe: false })
    const { caller } = await import('../helpers.ts')
    expect((await caller.kos.detail({ id: f.kos.id })).rooms[0]).toMatchObject({ reservedForWaitlist: true, offeredToMe: false })
  })

  it('respects room type: a freed Standar room skips a Deluxe entry', async () => {
    const f = await fullKos()
    const deluxe = await join(f.kos.id, 'Deluxe')
    const standar = await join(f.kos.id, 'Standar')
    const any = await join(f.kos.id, null)
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    expect((await entryRow(deluxe.entry.id)).status).toBe('WAITING')
    expect(await entryRow(standar.entry.id)).toMatchObject({ status: 'OFFERED', offeredRoomId: f.room('S1').id })
    expect((await entryRow(any.entry.id)).status).toBe('WAITING')

    // Standar is gone, so the next freed room (Deluxe) goes to the Deluxe entry, not the any-type one that joined later.
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.D1 })
    expect(await entryRow(deluxe.entry.id)).toMatchObject({ status: 'OFFERED', offeredRoomId: f.room('D1').id })
    expect((await entryRow(any.entry.id)).status).toBe('WAITING')
  })

  it('gives a free room that only an any-type entry fits to that entry', async () => {
    const f = await fullKos()
    await join(f.kos.id, 'Deluxe')
    const any = await join(f.kos.id, null)
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    expect(await entryRow(any.entry.id)).toMatchObject({ status: 'OFFERED', offeredRoomId: f.room('S1').id })
  })

  it('a free room that matches nobody stays open to normal booking', async () => {
    const f = await fullKos()
    const deluxe = await join(f.kos.id, 'Deluxe')
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    expect((await entryRow(deluxe.entry.id)).status).toBe('WAITING')
    const stranger = await newStudent()
    const res = await callerFor(stranger.id).booking.create({ roomId: f.room('S1').id, startDate: startDate(), durationMonths: 3 })
    expect(res.roomId).toBe(f.room('S1').id)
    // The waiting Deluxe student is not in the stranger's way, and keeps their place.
    expect((await entryRow(deluxe.entry.id)).status).toBe('WAITING')
  })

  it('a new room or a type change can be offered too', async () => {
    const f = await fullKos()
    const deluxe = await join(f.kos.id, 'Deluxe')
    await f.owner.room.create({ kosId: f.kos.id, roomNumber: 'D9', floor: 2, type: 'Deluxe', size: '4 x 4 m', bedType: 'Queen Bed', priceMonthly: 2_000_000 })
    expect((await entryRow(deluxe.entry.id)).status).toBe('OFFERED')

    const g = await fullKos([{ n: 'S1', type: 'Standar' }, { n: 'S2', type: 'Standar' }, { n: 'D1', type: 'Deluxe' }])
    const wantsDeluxe = await join(g.kos.id, 'Deluxe')
    await g.owner.tenancy.end({ kosId: g.kos.id, tenancyId: g.tenancies.S2 })
    expect((await entryRow(wantsDeluxe.entry.id)).status).toBe('WAITING')
    await g.owner.room.update({ kosId: g.kos.id, roomId: g.room('S2').id, roomNumber: 'S2', floor: 1, type: 'Deluxe', size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 1_500_000 })
    expect(await entryRow(wantsDeluxe.entry.id)).toMatchObject({ status: 'OFFERED', offeredRoomId: g.room('S2').id })
  })
})

describe('booking guard', () => {
  async function offered() {
    const f = await fullKos([{ n: 'S1', type: 'Standar' }])
    const a = await join(f.kos.id)
    const b = await join(f.kos.id)
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    return { f, a, b, roomId: f.room('S1').id }
  }

  it("refuses another student's booking of the offered room, including the next in line", async () => {
    const { a, b, roomId } = await offered()
    for (const who of [b.c, callerFor((await newStudent()).id)]) {
      const e = await err(who.booking.create({ roomId, startDate: startDate(), durationMonths: 3 }))
      expect(e?.code).toBe('CONFLICT')
      expect(e?.message).toBe('Kamar ini sedang ditawarkan ke pengantre lain.')
    }
    expect((await entryRow(a.entry.id)).status).toBe('OFFERED')
    expect(await prisma.tenancy.count({ where: { roomId, status: 'PENDING' } })).toBe(0)
  })

  it('lets the offeree book it and marks the entry FULFILLED', async () => {
    const { a, b, roomId } = await offered()
    const res = await a.c.booking.create({ roomId, startDate: startDate(), durationMonths: 3 })
    expect(res.roomId).toBe(roomId)
    expect(await entryRow(a.entry.id)).toMatchObject({ status: 'FULFILLED' })
    expect((await entryRow(a.entry.id)).resolvedAt).not.toBeNull()
    expect((await entryRow(b.entry.id)).status).toBe('WAITING')
  })

  it('queue-jump: a hold lapses with no tick, and a stranger booking the room gets CONFLICT because #1 holds the offer', async () => {
    const f = await fullKos([{ n: 'S1', type: 'Standar' }])
    // A live hold on the room, the student queues behind it, then the hold lapses (clock moves, no worker tick).
    await prisma.tenancy.update({ where: { id: f.tenancies.S1 }, data: { status: 'PENDING', expiresAt: new Date(Date.now() + HOUR) } })
    const a = await join(f.kos.id)
    await prisma.tenancy.update({ where: { id: f.tenancies.S1 }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await entryRow(a.entry.id)).status).toBe('WAITING')

    const stranger = await newStudent()
    const e = await err(callerFor(stranger.id).booking.create({ roomId: f.room('S1').id, startDate: startDate(), durationMonths: 3 }))
    expect(e?.code).toBe('CONFLICT')
    expect(e?.message).toBe('Kamar ini sedang ditawarkan ke pengantre lain.')
    // The advance committed even though the booking was refused: #1 now holds the offer and the email is queued.
    expect(await entryRow(a.entry.id)).toMatchObject({ status: 'OFFERED', offeredRoomId: f.room('S1').id })
    expect(await prisma.emailOutbox.count({ where: { template: 'waitlist-offer', to: a.s.email } })).toBe(1)
  })

  it("booking another open room closes the student's waiting entry, and releases an offer they did not use", async () => {
    const f = await fullKos([{ n: 'S1', type: 'Standar' }, { n: 'D1', type: 'Deluxe' }])
    const deluxe = await join(f.kos.id, 'Deluxe')
    const behind = await join(f.kos.id, 'Standar')
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    expect((await entryRow(behind.entry.id)).status).toBe('OFFERED')
    // The Deluxe waiter takes the Standar room that was nobody's... it is offered to `behind`, so they cannot.
    expect(await code(deluxe.c.booking.create({ roomId: f.room('S1').id, startDate: startDate(), durationMonths: 3 }))).toBe('CONFLICT')

    const g = await fullKos([{ n: 'S1', type: 'Standar' }, { n: 'D1', type: 'Deluxe' }])
    const wantsDeluxe = await join(g.kos.id, 'Deluxe')
    await g.owner.tenancy.end({ kosId: g.kos.id, tenancyId: g.tenancies.S1 }) // matches nobody: stays open
    await wantsDeluxe.c.booking.create({ roomId: g.room('S1').id, startDate: startDate(), durationMonths: 3 })
    expect((await entryRow(wantsDeluxe.entry.id)).status).toBe('FULFILLED')
  })
})

describe('lapse, decline and leave', () => {
  async function offered() {
    const f = await fullKos([{ n: 'S1', type: 'Standar' }])
    const a = await join(f.kos.id)
    const b = await join(f.kos.id)
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    return { f, a, b }
  }

  it('an offer past its deadline becomes EXPIRED and the next entry is offered', async () => {
    const { a, b } = await offered()
    await advanceAllWaitlists(prisma, new Date(Date.now() + 25 * HOUR))
    expect(await entryRow(a.entry.id)).toMatchObject({ status: 'EXPIRED' })
    expect((await entryRow(a.entry.id)).resolvedAt).not.toBeNull()
    expect((await entryRow(b.entry.id)).status).toBe('OFFERED')
    expect(await prisma.emailOutbox.count({ where: { template: 'waitlist-offer', to: b.s.email } })).toBe(1)
    // The expired student lost the place and sits in the history.
    expect((await a.c.waitlist.mine())[0]).toMatchObject({ status: 'EXPIRED', position: null })
  })

  it('an offer that is past its deadline but not yet advanced reads as EXPIRED to the student', async () => {
    const { a } = await offered()
    await prisma.waitlistEntry.update({ where: { id: a.entry.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } })
    const mine = (await a.c.waitlist.mine())[0]
    expect(mine).toMatchObject({ status: 'EXPIRED', offer: null })
  })

  it('decline marks DECLINED and passes the room on', async () => {
    const { a, b } = await offered()
    await a.c.waitlist.decline({ entryId: a.entry.id })
    expect((await entryRow(a.entry.id)).status).toBe('DECLINED')
    expect(await entryRow(b.entry.id)).toMatchObject({ status: 'OFFERED' })
    expect(await code(a.c.waitlist.decline({ entryId: a.entry.id }))).toBe('CONFLICT')
    expect(await code(callerFor((await newStudent()).id).waitlist.decline({ entryId: b.entry.id }))).toBe('FORBIDDEN')
  })

  it('leaving while OFFERED passes the room on; leaving while WAITING does not', async () => {
    const { a, b } = await offered()
    await a.c.waitlist.leave({ entryId: a.entry.id })
    expect((await entryRow(a.entry.id)).status).toBe('LEFT')
    expect((await entryRow(b.entry.id)).status).toBe('OFFERED')

    const f = await fullKos([{ n: 'S1', type: 'Standar' }])
    const w = await join(f.kos.id)
    await w.c.waitlist.leave({ entryId: w.entry.id })
    expect((await entryRow(w.entry.id)).status).toBe('LEFT')
    expect(await code(w.c.waitlist.leave({ entryId: w.entry.id }))).toBe('CONFLICT')
    // A student who left can join again.
    expect((await w.c.waitlist.join({ kosId: f.kos.id, roomType: null })).status).toBe('WAITING')
  })

  it("cannot touch somebody else's entry", async () => {
    const { a } = await offered()
    const other = callerFor((await newStudent()).id)
    expect(await code(other.waitlist.leave({ entryId: a.entry.id }))).toBe('FORBIDDEN')
  })

  it('an unpaid hold from a waitlist booking lapses and the next tick offers the room to the next entry', async () => {
    const { f, a, b } = await offered()
    const roomId = f.room('S1').id
    const booked = await a.c.booking.create({ roomId, startDate: startDate(), durationMonths: 3 })
    expect((await entryRow(a.entry.id)).status).toBe('FULFILLED')
    expect((await entryRow(b.entry.id)).status).toBe('WAITING')

    await prisma.tenancy.update({ where: { id: booked.tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await advanceAllWaitlists(prisma, new Date())
    expect(await entryRow(b.entry.id)).toMatchObject({ status: 'OFFERED', offeredRoomId: roomId })
    expect((await entryRow(a.entry.id)).status).toBe('FULFILLED') // never revived
  })
})

describe('owner waitlist', () => {
  it('lists the queue in order with positions, offers first', async () => {
    const f = await fullKos([{ n: 'S1', type: 'Standar' }, { n: 'D1', type: 'Deluxe' }])
    const a = await join(f.kos.id, 'Deluxe')
    const b = await join(f.kos.id, 'Standar')
    const c = await join(f.kos.id, null)
    let list = await f.owner.waitlistEntries({ kosId: f.kos.id })
    expect(list.map((e) => [e.id, e.position, e.status])).toEqual([
      [a.entry.id, 1, 'WAITING'],
      [b.entry.id, 1, 'WAITING'],
      [c.entry.id, 3, 'WAITING'],
    ])
    expect(list[0].user).toMatchObject({ name: a.s.name, campusVerified: false })
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    list = await f.owner.waitlistEntries({ kosId: f.kos.id })
    expect(list[0]).toMatchObject({ id: b.entry.id, status: 'OFFERED', position: null, offer: { roomNumber: 'S1' } })
    expect(list.slice(1).map((e) => [e.id, e.position])).toEqual([[a.entry.id, 1], [c.entry.id, 2]])
    const summary = (await f.owner.board({ kosId: f.kos.id })).summary
    expect(summary.waitlistCount).toBe(3)
  })

  it('remove is scoped to the kos: a foreign entry id is NOT_FOUND, a foreign kos is FORBIDDEN', async () => {
    const f = await fullKos()
    const g = await fullKos()
    const mineEntry = await join(f.kos.id)
    const theirs = await join(g.kos.id)
    expect(await code(f.owner.waitlist.remove({ kosId: f.kos.id, entryId: theirs.entry.id }))).toBe('NOT_FOUND')
    expect((await entryRow(theirs.entry.id)).status).toBe('WAITING')
    const other = callerFor((await newStudent()).id)
    expect(await code(other.owner.waitlist.remove({ kosId: f.kos.id, entryId: mineEntry.entry.id }))).toBe('FORBIDDEN')
    await f.owner.waitlist.remove({ kosId: f.kos.id, entryId: mineEntry.entry.id })
    expect((await entryRow(mineEntry.entry.id)).status).toBe('REMOVED')
    expect(await code(f.owner.waitlist.remove({ kosId: f.kos.id, entryId: mineEntry.entry.id }))).toBe('CONFLICT')
  })

  it('removing an OFFERED entry passes the room on', async () => {
    const f = await fullKos([{ n: 'S1', type: 'Standar' }])
    const a = await join(f.kos.id)
    const b = await join(f.kos.id)
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    await f.owner.waitlist.remove({ kosId: f.kos.id, entryId: a.entry.id })
    expect((await entryRow(b.entry.id)).status).toBe('OFFERED')
  })
})

describe('deleting with a live offer', () => {
  it('refuses kos.delete and room.delete until the offer is gone', async () => {
    const f = await fullKos([{ n: 'S1', type: 'Standar' }])
    const a = await join(f.kos.id)
    await f.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancies.S1 })
    const roomId = f.room('S1').id
    for (const attempt of [() => f.owner.room.delete({ kosId: f.kos.id, roomId }), () => f.owner.kos.delete({ kosId: f.kos.id })]) {
      const e = await err(attempt())
      expect(e?.code).toBe('CONFLICT')
      expect(e?.message).toBe('Masih ada penawaran daftar tunggu aktif.')
    }
    await a.c.waitlist.decline({ entryId: a.entry.id })
    await f.owner.room.delete({ kosId: f.kos.id, roomId })
    expect(await prisma.room.count({ where: { id: roomId } })).toBe(0)
  })

  it('cascades waiting entries when a kos with no live offer is deleted', async () => {
    const f = await makeKos([{ n: 'S1', type: 'Standar' }])
    const entry = await prisma.waitlistEntry.create({ data: { kosId: f.kos.id, userId: (await newStudent()).id } })
    await f.owner.kos.delete({ kosId: f.kos.id })
    expect(await prisma.waitlistEntry.count({ where: { id: entry.id } })).toBe(0)
  })
})

describe('resetDemo', () => {
  it("removes the demo student's entries and demo-owned queues but keeps real users' entries elsewhere", async () => {
    const demoStudent = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAILS.student } })
    const a = await fullKos()
    const b = await fullKos()
    const real = await newStudent()
    const demoEntry = await callerFor(demoStudent.id).waitlist.join({ kosId: a.kos.id, roomType: null })
    const realEntry = await callerFor(real.id).waitlist.join({ kosId: b.kos.id, roomType: null })
    await resetDemo(prisma, new Date())
    expect(await prisma.waitlistEntry.count({ where: { id: demoEntry.id } })).toBe(0)
    expect((await entryRow(realEntry.id)).status).toBe('WAITING')
  })

  it("drops the queue of a kos the demo owner added, and leaves queues on other owners' kos", async () => {
    const demoOwner = await prisma.ownerProfile.findFirstOrThrow({ where: { user: { email: DEMO_EMAILS.owner } } })
    const added = await prisma.kos.create({
      data: { slug: 'demo-tambahan', name: 'Demo Tambahan', gender: 'CAMPUR', address: 'x', district: 'x', city: 'x', lat: 0, lng: 0, electricityType: 'INCLUDED', ownerId: demoOwner.id },
    })
    const real = await newStudent()
    const entry = await prisma.waitlistEntry.create({ data: { kosId: added.id, userId: real.id } })
    await resetDemo(prisma, new Date())
    expect(await prisma.waitlistEntry.count({ where: { id: entry.id } })).toBe(0)
  })
})
