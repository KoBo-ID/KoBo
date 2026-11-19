import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { renderEmail } from '../../src/emailTemplates.ts'
import { advanceAllWaitlists, roomClaims } from '../../src/waitlist.ts'
import { callerFor, newStudent, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const startDate = () => addDays(todayWIB(new Date()), 3)
const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null

/** A one-room kos whose room is held by an ACTIVE tenancy; one student waits, then the room is freed and offered. */
async function offered() {
  const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { user: { isDemo: false } }, orderBy: { id: 'asc' } })
  const kos = await prisma.kos.create({
    data: {
      slug: 'offer-flow',
      name: 'Kos Offer Flow',
      gender: 'CAMPUR',
      address: 'Jl. Offer',
      district: 'Kebayoran',
      city: 'Jakarta',
      lat: -6.2,
      lng: 106.8,
      electricityType: 'INCLUDED',
      ownerId: owner.id,
      rooms: { create: [{ roomNumber: 'O1', floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 1_500_000 }] },
    },
    include: { rooms: true },
  })
  const room = kos.rooms[0]
  const tenant = await newStudent()
  const tenancy = await prisma.tenancy.create({ data: { roomId: room.id, userId: tenant.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 } })
  await prisma.room.update({ where: { id: room.id }, data: { occupancy: 'OCCUPIED' } })
  const a = await newStudent()
  const b = await newStudent()
  const ea = await callerFor(a.id).waitlist.join({ kosId: kos.id, roomType: null })
  const eb = await callerFor(b.id).waitlist.join({ kosId: kos.id, roomType: null })
  const ownerCaller = callerFor(owner.userId)
  await ownerCaller.owner.tenancy.end({ kosId: kos.id, tenancyId: tenancy.id })
  expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: ea.id } })).status).toBe('OFFERED')
  const lapse = () => prisma.waitlistEntry.update({ where: { id: ea.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } })
  const apply = () => callerFor(a.id).application.create({ roomId: room.id, startDate: startDate(), durationMonths: 3 })
  return { kos, room, a, b, ea, eb, owner: ownerCaller, lapse, apply }
}
const entry = (id: string) => prisma.waitlistEntry.findUniqueOrThrow({ where: { id } })

describe('A-007: an offer is held while the owner reviews the offeree application', () => {
  it('links the application to the offer and keeps the room past the deadline', async () => {
    const f = await offered()
    const app = await f.apply()
    expect((await entry(f.ea.id)).applicationId).toBe(app.id)
    await f.lapse()
    await advanceAllWaitlists(prisma)
    expect((await entry(f.ea.id)).status).toBe('OFFERED')
    expect((await entry(f.eb.id)).status).toBe('WAITING')
    expect((await roomClaims(prisma, f.kos.id, new Date())).get(f.room.id)).toBe(f.a.id)
    // Nobody else can slip in while it is held.
    const stranger = await newStudent()
    const e = await err(callerFor(stranger.id).application.create({ roomId: f.room.id, startDate: startDate(), durationMonths: 3 }))
    expect(e?.code).toBe('CONFLICT')
    expect(e?.message).toBe('Kamar ini sedang ditawarkan ke pengantre lain.')
    // The student still sees a live offer rather than an expired one.
    expect((await callerFor(f.a.id).waitlist.mine()).find((m) => m.id === f.ea.id)?.status).toBe('OFFERED')
  })

  it('without an application the offer still lapses and the queue advances', async () => {
    const f = await offered()
    await f.lapse()
    await advanceAllWaitlists(prisma)
    expect((await entry(f.ea.id)).status).toBe('EXPIRED')
    expect((await entry(f.eb.id)).status).toBe('OFFERED')
  })

  it('approval resolves the entry as FULFILLED, even after the deadline', async () => {
    const f = await offered()
    const app = await f.apply()
    await f.lapse()
    const res = await f.owner.application.decide({ kosId: f.kos.id, applicationId: app.id, decision: 'APPROVE' })
    expect(res.status).toBe('APPROVED')
    expect((await entry(f.ea.id)).status).toBe('FULFILLED')
    expect((await entry(f.eb.id)).status).toBe('WAITING')
  })

  it('rejection ends the offer at once, deadline or not, and the next waiter gets the room', async () => {
    const f = await offered()
    const app = await f.apply()
    await f.owner.application.decide({ kosId: f.kos.id, applicationId: app.id, decision: 'REJECT' })
    // Not live any more the moment the application is rejected (no worker tick needed to free the room).
    expect((await roomClaims(prisma, f.kos.id, new Date())).get(f.room.id)).not.toBe(f.a.id)
    await advanceAllWaitlists(prisma)
    expect((await entry(f.ea.id)).status).toBe('EXPIRED')
    expect((await entry(f.eb.id)).status).toBe('OFFERED')
  })

  it('the offer email asks the student to apply and says it is held during review', () => {
    const out = renderEmail('waitlist-offer', { name: 'Ayu', kosName: 'Kos X', roomNumber: '1', expiresAt: new Date(Date.now() + 3600_000).toISOString(), url: 'http://x/kos/1' })
    expect(out?.text).toContain('Ajukan sewa sebelum')
    expect(out?.text).toContain('ditahan selama pemilik meninjau')
    expect(out?.text).not.toContain('Pesan sebelum')
  })
})

describe('A-002: archived kos never hand out offers', () => {
  it('a WAITING entry of an archived kos gets no offer and the room is not claimed', async () => {
    const f = await offered()
    // Back to the state before the offer: entries WAITING, kos then archived.
    await prisma.waitlistEntry.updateMany({ where: { kosId: f.kos.id }, data: { status: 'WAITING', offeredRoomId: null, offerExpiresAt: null } })
    await prisma.kos.update({ where: { id: f.kos.id }, data: { archivedAt: new Date() } })
    await advanceAllWaitlists(prisma)
    expect(await prisma.waitlistEntry.count({ where: { kosId: f.kos.id, status: 'OFFERED' } })).toBe(0)
    expect(await prisma.emailOutbox.count({ where: { template: 'waitlist-offer', to: (await prisma.user.findUniqueOrThrow({ where: { id: f.a.id } })).email } })).toBe(1) // only the earlier, legitimate one
    expect((await roomClaims(prisma, f.kos.id, new Date())).size).toBe(0)
  })

  it('an archived room is never offered', async () => {
    const f = await offered()
    await prisma.waitlistEntry.updateMany({ where: { kosId: f.kos.id }, data: { status: 'WAITING', offeredRoomId: null, offerExpiresAt: null } })
    await prisma.room.update({ where: { id: f.room.id }, data: { archivedAt: new Date() } })
    await advanceAllWaitlists(prisma)
    expect(await prisma.waitlistEntry.count({ where: { kosId: f.kos.id, status: 'OFFERED' } })).toBe(0)
  })
})
