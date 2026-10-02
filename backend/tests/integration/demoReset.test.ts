import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_EMAILS } from '../../src/demo.ts'
import { resetDemo } from '../../src/demoReset.ts'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, caller, DEMO_STUDENT_ID, newStudent, prisma, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code
const startDate = () => addDays(todayWIB(new Date()), 3)

async function demoOwner() {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAILS.owner }, include: { ownerProfile: { include: { kos: { orderBy: { createdAt: 'asc' } } } } } })
  return { userId: u.id, profile: u.ownerProfile!, kos: u.ownerProfile!.kos }
}
async function otherOwner() {
  const o = await prisma.ownerProfile.findFirstOrThrow({ where: { user: { isDemo: false }, kos: { some: {} } }, include: { kos: true, user: true }, orderBy: { id: 'asc' } })
  return { userId: o.userId, kos: o.kos }
}
/** A vacant room inside (or outside) the given kos ids. */
async function vacantRoomWhere(kosIds: string[], inside: boolean) {
  for (let i = 0; i < 80; i++) {
    const r = await vacantRoom(i)
    if (kosIds.includes(r.kosId) === inside) return r
  }
  throw new Error('no suitable vacant room')
}

describe('resetDemo', () => {
  it("removes the demo student's booking and frees the room again", async () => {
    const room = await vacantRoom()
    const res = await callerFor(DEMO_STUDENT_ID).booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 6 })
    await resetDemo(prisma, new Date())
    expect(await prisma.tenancy.findUnique({ where: { id: res.tenancyId } })).toBeNull()
    expect(await prisma.invoice.count({ where: { id: res.invoiceId } })).toBe(0)
    expect(await prisma.payment.count({ where: { id: res.payment.id } })).toBe(0)
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).occupancy).toBe('VACANT')
  })

  it("leaves a real user's booking alone, in the demo owner's kos and in another kos", async () => {
    const demo = await demoOwner()
    const real = await newStudent()
    const inDemo = await vacantRoomWhere(demo.kos.map((k) => k.id), true)
    const elsewhere = await vacantRoomWhere(demo.kos.map((k) => k.id), false)
    const a = await callerFor(real.id).booking.create({ roomId: inDemo.id, startDate: startDate(), durationMonths: 3 })
    const b = await callerFor(real.id).booking.create({ roomId: elsewhere.id, startDate: startDate(), durationMonths: 3 })
    await resetDemo(prisma, new Date())
    for (const t of [a, b]) {
      const row = await prisma.tenancy.findUnique({ where: { id: t.tenancyId }, include: { invoices: { include: { payments: true } } } })
      expect(row?.status).toBe('PENDING')
      expect(row?.invoices[0].payments).toHaveLength(1)
    }
  })

  it("restores the demo owner's edited kos name, and removes kos and rooms they added", async () => {
    const demo = await demoOwner()
    const original = demo.kos[0]
    const owner = callerFor(demo.userId)
    await owner.owner.kos.update({
      kosId: original.id,
      name: 'Dirusak Vandal',
      gender: original.gender,
      address: original.address,
      district: original.district,
      city: original.city,
      lat: original.lat,
      lng: original.lng,
      electricityType: original.electricityType,
      privateAmenities: [],
      sharedAmenities: [],
      studentDiscountAmount: 0,
    })
    const created = await owner.owner.kos.create({ name: 'Kos Baru Demo', gender: 'CAMPUR', address: 'Jl. Uji 1', district: 'Uji', city: 'Jakarta', lat: -6.2, lng: 106.8, electricityType: 'INCLUDED', privateAmenities: [], sharedAmenities: [], studentDiscountAmount: 0 })
    const extraRoom = await owner.owner.room.create({ kosId: original.id, roomNumber: 'X99', floor: 1, type: 'Uji', size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 500_000 })
    await resetDemo(prisma, new Date())
    const after = await prisma.kos.findUniqueOrThrow({ where: { id: original.id } })
    expect(after).toMatchObject({ name: original.name, privateAmenities: original.privateAmenities, studentDiscountAmount: original.studentDiscountAmount })
    expect(await prisma.kos.findUnique({ where: { id: created.id } })).toBeNull()
    expect(await prisma.room.findUnique({ where: { id: extraRoom.id } })).toBeNull()
  })

  it("restores what the demo owner did to seeded tenancies and reviews (move-out, reply)", async () => {
    const demo = await demoOwner()
    const kosId = demo.kos[0].id
    const active = await prisma.tenancy.findFirstOrThrow({ where: { status: 'ACTIVE', room: { kosId } }, include: { invoices: true } })
    const review = await prisma.review.findFirstOrThrow({ where: { tenancy: { room: { kosId } }, ownerReply: null } })
    const owner = callerFor(demo.userId)
    await owner.owner.tenancy.end({ kosId, tenancyId: active.id })
    await owner.review.reply({ kosId, reviewId: review.id, text: 'Terima kasih atas ulasannya!' })
    await resetDemo(prisma, new Date())
    const t = await prisma.tenancy.findUniqueOrThrow({ where: { id: active.id }, include: { invoices: true, room: true } })
    expect(t.status).toBe('ACTIVE')
    expect(t.invoices).toHaveLength(active.invoices.length)
    expect(t.room.occupancy).toBe('OCCUPIED')
    expect((await prisma.review.findUniqueOrThrow({ where: { id: review.id } })).ownerReply).toBeNull()
  })

  it("removes the demo student's visits but keeps a real student's visit", async () => {
    const demo = await demoOwner()
    const real = await newStudent()
    const date = startDate()
    await callerFor(DEMO_STUDENT_ID).visit.create({ kosId: demo.kos[0].id, date, timeSlot: 'PAGI' })
    const kept = await callerFor(real.id).visit.create({ kosId: demo.kos[0].id, date, timeSlot: 'SIANG' })
    await resetDemo(prisma, new Date())
    expect(await prisma.visit.count({ where: { userId: DEMO_STUDENT_ID } })).toBe(0)
    expect(await prisma.visit.findUnique({ where: { id: kept.id } })).not.toBeNull()
  })

  it("does not touch another owner's kos edits", async () => {
    const other = await otherOwner()
    await prisma.kos.update({ where: { id: other.kos[0].id }, data: { name: 'Nama Pemilik Lain' } })
    await resetDemo(prisma, new Date())
    expect((await prisma.kos.findUniqueOrThrow({ where: { id: other.kos[0].id } })).name).toBe('Nama Pemilik Lain')
  })

  it("keeps a real user's booking on a room whose seeded tenancy the demo owner ended", async () => {
    const demo = await demoOwner()
    const kosId = demo.kos[0].id
    const active = await prisma.tenancy.findFirstOrThrow({ where: { status: 'ACTIVE', room: { kosId } } })
    await callerFor(demo.userId).owner.tenancy.end({ kosId, tenancyId: active.id })
    const real = await newStudent()
    const booked = await callerFor(real.id).booking.create({ roomId: active.roomId, startDate: startDate(), durationMonths: 3 })
    await resetDemo(prisma, new Date())
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: booked.tenancyId } })).status).toBe('PENDING')
    // The seeded tenant cannot come back into a room that a real user now holds.
    expect(await prisma.tenancy.findUnique({ where: { id: active.id } })).toBeNull()
    expect(await prisma.tenancy.count({ where: { roomId: active.roomId, status: { in: ['PENDING', 'ACTIVE'] } } })).toBe(1)
  })

  it('restores the demo accounts own profile fields', async () => {
    await prisma.user.update({ where: { id: DEMO_STUDENT_ID }, data: { name: 'Vandal', phone: '000', campus: 'Lain' } })
    await resetDemo(prisma, new Date())
    expect(await prisma.user.findUniqueOrThrow({ where: { id: DEMO_STUDENT_ID } })).toMatchObject({ name: 'Demo Mahasiswa', phone: null, campus: 'Binus Syahdan' })
  })

  it('is idempotent: a second reset changes nothing', async () => {
    const count = async () => [await prisma.tenancy.count(), await prisma.invoice.count(), await prisma.payment.count(), await prisma.review.count(), await prisma.room.count(), await prisma.kos.count()]
    await resetDemo(prisma, new Date())
    const first = await count()
    await resetDemo(prisma, new Date())
    expect(await count()).toEqual(first)
  })

  it('a reset right after seeding keeps the seed row counts', async () => {
    const before = [await prisma.tenancy.count(), await prisma.invoice.count(), await prisma.payment.count(), await prisma.review.count(), await prisma.room.count(), await prisma.kosImage.count()]
    await resetDemo(prisma, new Date())
    expect([await prisma.tenancy.count(), await prisma.invoice.count(), await prisma.payment.count(), await prisma.review.count(), await prisma.room.count(), await prisma.kosImage.count()]).toEqual(before)
  })
})

describe('demo.reset (the on-demand action)', () => {
  it('runs for a demo user', async () => {
    const room = await vacantRoom()
    const res = await callerFor(DEMO_STUDENT_ID).booking.create({ roomId: room.id, startDate: startDate(), durationMonths: 6 })
    await callerFor(DEMO_STUDENT_ID).demo.reset()
    expect(await prisma.tenancy.findUnique({ where: { id: res.tenancyId } })).toBeNull()
  })

  it('works for the demo owner as well', async () => {
    const demo = await demoOwner()
    await prisma.kos.update({ where: { id: demo.kos[0].id }, data: { name: 'X' } })
    await callerFor(demo.userId).demo.reset()
    expect((await prisma.kos.findUniqueOrThrow({ where: { id: demo.kos[0].id } })).name).toBe(demo.kos[0].name)
  })

  it('is refused for a real user and for anonymous callers', async () => {
    const real = await newStudent()
    expect(await code(callerFor(real.id).demo.reset())).toBe('FORBIDDEN')
    expect(await code(caller.demo.reset())).toBe('UNAUTHORIZED')
  })
})
