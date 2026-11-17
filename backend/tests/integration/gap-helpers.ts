// Helpers for the gap-* integration tests only (they sit next to, and build on, tests/helpers.ts).
import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { callerFor, prisma, newStudent } from '../helpers.ts'

export const GENERIC_VALIDATION = 'Data yang dikirim tidak valid. Periksa kembali isian Anda.'

export const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
export const code = async (p: Promise<unknown>) => (await err(p))?.code

/** Two seeded owners that each own at least one kos. */
export async function twoOwners() {
  const owners = await prisma.ownerProfile.findMany({ include: { kos: { orderBy: { createdAt: 'asc' } }, user: true }, orderBy: { id: 'asc' } })
  const [a, b] = owners.filter((o) => o.kos.length > 0)
  return { a, b }
}

/** Calls a procedure by its dotted router path, e.g. call(caller, 'owner.image.presign', input). */
export function call(c: unknown, path: string, input?: unknown): Promise<unknown> {
  const fn = path.split('.').reduce((acc: any, key) => acc[key], c as any)
  return input === undefined ? fn() : fn(input)
}

export const startIn = (days: number, now = new Date()) => addDays(todayWIB(now), days)

/** An application by a fresh student for `roomId`, left PENDING. */
export async function pendingApplication(roomId: string, over: { startDate?: string; durationMonths?: number } = {}) {
  const renter = await newStudent()
  const created = await callerFor(renter.id).application.create({ roomId, startDate: over.startDate ?? startIn(5), durationMonths: over.durationMonths ?? 3, occupation: 'Mahasiswa', note: 'Uji.' })
  return { renter, applicationId: created.id }
}

const TABLES = ['Kos', 'Room', 'Tenancy', 'Invoice', 'Payment', 'RentalApplication', 'Visit', 'WaitlistEntry', 'Review', 'KosImage', 'HouseRule', 'User', 'NotificationLog'] as const

/** Row counts of the tables a denied call must never change. */
export async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of TABLES) {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`)
    out[t] = Number(rows[0]!.n)
  }
  return out
}

export const kosInput = (over: Record<string, unknown> = {}) => ({
  name: 'Kost Gap Uji',
  gender: 'CAMPUR' as const,
  address: 'Jl. Uji No. 1',
  district: 'Kemanggisan',
  city: 'Jakarta Barat',
  lat: -6.2005,
  lng: 106.7855,
  electricityType: 'TOKEN' as const,
  privateAmenities: ['AC'],
  sharedAmenities: ['Wi-Fi'],
  studentDiscountAmount: 100000,
  ...over,
})

export const roomInput = (over: Record<string, unknown> = {}) => ({ roomNumber: 'G99', floor: 2, type: 'Standar', size: '3 x 3 m', bedType: 'Single', priceMonthly: 1_000_000, ...over })

let kosSeq = 0
/** A fresh kos with the given rooms ({ n: room number, type }), all vacant, owned by the first non-demo owner. */
export async function makeKos(rooms: { n: string; type: string; price?: number }[], over: { applicationFee?: number; studentDiscountAmount?: number } = {}) {
  const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { user: { isDemo: false } }, orderBy: { id: 'asc' } })
  const seq = ++kosSeq
  const kos = await prisma.kos.create({
    data: {
      slug: `gap-${Date.now()}-${seq}`,
      name: `Kos Gap ${seq}`,
      gender: 'CAMPUR',
      address: 'Jl. Gap',
      district: 'Kebayoran',
      city: 'Jakarta',
      lat: -6.2,
      lng: 106.8,
      electricityType: 'INCLUDED',
      ownerId: owner.id,
      ...over,
      rooms: { create: rooms.map((r) => ({ roomNumber: r.n, floor: 1, type: r.type, size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: r.price ?? 1_500_000 })) },
    },
    include: { rooms: true },
  })
  const byNumber = Object.fromEntries(kos.rooms.map((r) => [r.roomNumber, r]))
  return { kos, owner: callerFor(owner.userId).owner, ownerUserId: owner.userId, room: (n: string) => byNumber[n]! }
}

/** Occupies a room with an ACTIVE tenancy of a fresh student. */
export async function occupy(roomId: string) {
  const tenant = await newStudent()
  const t = await prisma.tenancy.create({ data: { roomId, userId: tenant.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 } })
  await prisma.room.update({ where: { id: roomId }, data: { occupancy: 'OCCUPIED' } })
  return t.id
}

/** A student joins the queue of a full kos. */
export async function joinQueue(kosId: string, roomType: string | null = null) {
  const s = await newStudent()
  const entry = await callerFor(s.id).waitlist.join({ kosId, roomType })
  return { s, c: callerFor(s.id), entry }
}

let ownerSeq = 0
/** A fresh, approved owner with no kos. */
export async function newOwner() {
  const n = ++ownerSeq
  const user = await prisma.user.create({ data: { id: `gap-owner-${Date.now()}-${n}`, name: `Pemilik Gap ${n}`, email: `gap-owner-${Date.now()}-${n}@kobo.test`, emailVerified: true } })
  const profile = await prisma.ownerProfile.create({ data: { userId: user.id, approvedAt: new Date() } })
  return { userId: user.id, ownerId: profile.id, c: callerFor(user.id) }
}

/** An ACTIVE tenancy of `userId` with a PAID invoice in a vacant seeded room (what review.create needs). */
export async function paidTenancy(userId: string, nth = 0) {
  const { vacantRoom } = await import('../helpers.ts')
  const room = await vacantRoom(nth)
  const now = Date.now()
  const tenancy = await prisma.tenancy.create({ data: { roomId: room.id, userId, status: 'ACTIVE', startDate: new Date(now), durationMonths: 3 } })
  await prisma.invoice.create({
    data: {
      tenancyId: tenancy.id, periodStart: new Date(now), dueDate: new Date(now), amount: 1_000_000, rentAmount: 1_000_000, discountAmount: 0,
      applicationFeeAmount: 0, ownerReceivableAmount: 1_000_000, gatewayFeeBearer: 'PLATFORM', status: 'PAID',
    },
  })
  return { tenancy, room }
}
