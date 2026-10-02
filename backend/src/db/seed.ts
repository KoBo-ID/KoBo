import { addDays, addMonths, todayWIB } from '@kobo/shared/domain'
import { DEMO_EMAILS } from '../demo.ts'
import type { PrismaClient } from './client.ts'
import rawData from './seedData.json' with { type: 'json' }

/*
 * Deterministic seed. Source: snapshot of frontend/src/data (a one-off snapshot of the old frontend mock data).
 *
 * The mock card numbers (reviewCount, totalRooms, availableRooms, rating) disagree with the mock rows
 * (e.g. kos-4 says 15 rooms but lists 2). Aggregates are computed on read now, so this seed generates
 * filler rooms, ENDED tenancies and reviews until the computed numbers match the mock card numbers.
 * Randomness comes from a fixed-seed PRNG; the only external input is `now` (dates are relative to it
 * so the demo never shows every room overdue).
 */

interface MockRoom {
  id: string
  roomNumber: string
  floor: number
  roomType: string
  size: string
  bedType: string
  priceMonthly: number
  status: 'paid' | 'due' | 'overdue' | 'vacant' | 'booking'
  tenantName?: string
  tenantPhone?: string
  tenantCampus?: string
  daysOverdue?: number
}
interface MockKos {
  id: string
  name: string
  slug: string
  gender: 'campur' | 'putra' | 'putri'
  address: string
  district: string
  city: string
  coordinates: { lat: number; lng: number }
  campusProximity: { campusId: string; distanceMeters: number }
  rating: number
  reviewCount: number
  priceMonthlyStart: number
  studentDiscountAmount: number
  images: string[]
  privateAmenities: string[]
  sharedAmenities: string[]
  electricityType: 'included' | 'token'
  totalRooms: number
  availableRooms: number
  owner: {
    id: string
    name: string
    phone: string
    avatar: string
    responseRate: string
    memberSince: string
    verified: boolean
    bio?: string
  }
  rules: { id: string; tier: number; categoryTitle: string; rules: string[]; penaltyAmount?: number; penaltyClause?: string }[]
  pois: { id: string; category: string; name: string; distanceMeters: number; walkMinutes: number; description: string }[]
  rooms: MockRoom[]
}
interface MockReview {
  kosId: string
  authorName: string
  authorCampus: string
  ratingOverall: number
  subRatings: { cleanliness: number; wifi: number; owner: number; quietness: number }
  comment: string
  ownerReply?: { text: string }
}
const data = rawData as unknown as {
  campuses: { id: string; name: string; shortName: string; city: string; coordinates: { lat: number; lng: number } }[]
  kos: MockKos[]
  reviews: MockReview[]
}

const EMAIL_DOMAINS: Record<string, string[]> = {
  'binus-syahdan': ['binus.ac.id', 'student.binus.ac.id'],
  'binus-anggrek': ['binus.ac.id', 'student.binus.ac.id'],
  'binus-kijang': ['binus.ac.id', 'student.binus.ac.id'],
  'ui-depok': ['ui.ac.id'],
  'itb-ganesha': ['itb.ac.id', 'students.itb.ac.id'],
}

const MONTHS: Record<string, number> = {
  Januari: 1, Februari: 2, Maret: 3, April: 4, Mei: 5, Juni: 6, Juli: 7, Agustus: 8,
  September: 9, Oktober: 10, November: 11, Desember: 12,
}

const FIRST = ['Aditya', 'Bagas', 'Citra', 'Dewi', 'Eko', 'Farah', 'Galih', 'Hana', 'Indra', 'Jihan', 'Kirana', 'Lukman', 'Maya', 'Naufal', 'Oki', 'Putri', 'Qori', 'Rina', 'Satria', 'Tiara']
const LAST = ['Pratama', 'Wijaya', 'Santoso', 'Lestari', 'Hidayat', 'Kusuma', 'Saputra', 'Nugroho', 'Rahma', 'Utami', 'Firmansyah', 'Anggraini']
const COMMENTS = [
  'Kamar bersih dan pemilik kos responsif. Cocok untuk mahasiswa.',
  'Lokasi dekat kampus, tinggal jalan kaki. Wi-Fi lancar untuk kuliah daring.',
  'Lingkungan tenang dan aman, akses 24 jam. Sangat nyaman untuk belajar.',
  'Fasilitas sesuai deskripsi, air selalu lancar, dan area parkir luas.',
  'Penghuni lain ramah dan kos selalu rapi. Akan merekomendasikan ke teman.',
  'Harga sebanding dengan fasilitas. Pengelola cepat menangani keluhan.',
  'Dapur bersama bersih dan banyak warung makan murah di sekitar kos.',
  'Pernah ada gangguan Wi-Fi sebentar, tapi segera diperbaiki. Secara umum puas.',
]

/** mulberry32: tiny, fast, deterministic. */
function makeRng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
  }
}

const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`)
const atWIB = (s: string, hour = 10) => new Date(`${s}T${String(hour).padStart(2, '0')}:00:00+07:00`)

function parseMemberSince(s: string): Date {
  const [m, y] = s.split(' ')
  return new Date(Date.UTC(Number(y), (MONTHS[m] ?? 1) - 1, 1))
}

/** Everything the seed inserts, as plain rows. resetDemo() takes a slice of this instead of truncating. */
export interface SeedRows {
  users: { id: string; isDemo?: boolean; [k: string]: unknown }[]
  campuses: object[]
  ownerProfiles: { id: string; userId: string; [k: string]: unknown }[]
  kos: { id: string; ownerId: string; [k: string]: unknown }[]
  images: { id: string; kosId: string }[]
  rules: { id: string; kosId: string }[]
  pois: { id: string; kosId: string }[]
  rooms: { id: string; kosId: string; occupancy: 'VACANT' | 'BOOKED' | 'OCCUPIED'; [k: string]: unknown }[]
  tenancies: { id: string; roomId: string; userId: string; status: 'PENDING' | 'ACTIVE' | 'ENDED'; [k: string]: unknown }[]
  invoices: { id: string; tenancyId: string; [k: string]: unknown }[]
  payments: { id: string; invoiceId: string; [k: string]: unknown }[]
  reviews: { id: string; tenancyId: string; [k: string]: unknown }[]
}

export function buildSeed(now: Date): SeedRows {
  const today = todayWIB(now)
  const rng = makeRng(20261001)

  // ---- campuses
  const campuses = data.campuses.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    city: c.city,
    lat: c.coordinates.lat,
    lng: c.coordinates.lng,
    emailDomains: EMAIL_DOMAINS[c.id] ?? [],
  }))

  // ---- users
  type UserRow = {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image?: string
    phone?: string
    campus?: string
    campusEmail?: string
    campusEmailVerifiedAt?: Date
    isDemo?: boolean
    createdAt: Date
  }
  const users: UserRow[] = []
  const baseCreated = new Date('2026-01-01T00:00:00Z')

  const owners = new Map<string, MockKos['owner']>()
  for (const k of data.kos) owners.set(k.owner.id, k.owner)
  const ownerProfiles = [...owners.values()].map((o, i) => {
    const demo = i === 0 // owner of the first kos is the demo owner
    users.push({
      id: `user-${o.id}`,
      name: o.name,
      email: demo ? DEMO_EMAILS.owner : `${o.id}@kobo.test`,
      emailVerified: true,
      image: o.avatar,
      phone: o.phone,
      isDemo: demo,
      createdAt: baseCreated,
    })
    return {
      id: o.id,
      userId: `user-${o.id}`,
      bio: o.bio ?? null,
      verified: o.verified,
      responseRate: o.responseRate,
      memberSince: parseMemberSince(o.memberSince),
    }
  })

  users.push({
    id: 'user-demo-student',
    name: 'Demo Mahasiswa',
    email: DEMO_EMAILS.student,
    emailVerified: true,
    campus: 'Binus Syahdan',
    campusEmail: 'demo.mahasiswa@student.binus.ac.id',
    campusEmailVerifiedAt: baseCreated,
    isDemo: true,
    createdAt: baseCreated,
  })

  const pool: UserRow[] = []
  for (let i = 0; i < 40; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`
    const u: UserRow = { id: `user-student-${i + 1}`, name, email: `student-${i + 1}@kobo.test`, emailVerified: true, createdAt: baseCreated }
    pool.push(u)
    users.push(u)
  }

  // ---- kos-level rows
  const kosRows: object[] = []
  const imageRows: object[] = []
  const ruleRows: object[] = []
  const poiRows: object[] = []
  type RoomRow = {
    id: string
    kosId: string
    roomNumber: string
    floor: number
    type: string
    size: string
    bedType: string
    priceMonthly: number
    occupancy: 'VACANT' | 'BOOKED' | 'OCCUPIED'
  }
  const roomRows: RoomRow[] = []
  const tenancyRows: object[] = []
  const invoiceRows: object[] = []
  const paymentRows: object[] = []
  const reviewRows: object[] = []
  let seq = 0 // stable id suffix for generated rows

  const addActiveTenancy = (room: RoomRow, userId: string, status: 'paid' | 'due' | 'overdue', overdueDays: number, kosFee: number) => {
    const durationMonths = 6
    const currentDue =
      status === 'paid' ? addDays(today, rng.int(10, 25)) : status === 'due' ? addDays(today, rng.int(0, 2)) : addDays(today, -Math.max(1, overdueDays))
    const id = `ten-${++seq}`
    const firstDue = addMonths(currentDue, -1)
    tenancyRows.push({
      id,
      roomId: room.id,
      userId,
      status: 'ACTIVE',
      startDate: atWIB(firstDue),
      durationMonths,
      createdAt: atWIB(addDays(firstDue, -2)),
    })
    for (let m = 0; m < durationMonths; m++) {
      const due = addMonths(firstDue, m)
      const invId = `inv-${id}-${m + 1}`
      const paid = m === 0
      invoiceRows.push({ id: invId, tenancyId: id, periodStart: dateOnly(due), dueDate: dateOnly(due), amount: room.priceMonthly, status: paid ? 'PAID' : 'UNPAID' })
      if (paid) {
        paymentRows.push({
          id: `pay-${invId}`,
          invoiceId: invId,
          provider: 'MOCK',
          externalId: `seed-${invId}`,
          amount: room.priceMonthly + (m === 0 ? kosFee : 0),
          status: 'PAID',
          paidAt: atWIB(addDays(due, -1), 14),
        })
      }
    }
    room.occupancy = 'OCCUPIED'
  }

  const addPendingTenancy = (room: RoomRow, userId: string, kosFee: number) => {
    const id = `ten-${++seq}`
    const created = new Date(now.getTime() - 2 * 3600_000)
    tenancyRows.push({
      id,
      roomId: room.id,
      userId,
      status: 'PENDING',
      startDate: atWIB(addDays(today, 7)),
      durationMonths: 6,
      expiresAt: new Date(created.getTime() + 24 * 3600_000),
      createdAt: created,
    })
    const invId = `inv-${id}-1`
    invoiceRows.push({ id: invId, tenancyId: id, periodStart: dateOnly(addDays(today, 7)), dueDate: dateOnly(addDays(today, 7)), amount: room.priceMonthly, status: 'UNPAID' })
    paymentRows.push({ id: `pay-${invId}`, invoiceId: invId, provider: 'MOCK', externalId: `seed-${invId}`, amount: room.priceMonthly + kosFee, status: 'PENDING' })
    room.occupancy = 'BOOKED'
  }

  data.kos.forEach((k, ki) => {
    const fee = 25000
    kosRows.push({
      id: k.id,
      slug: k.slug,
      name: k.name,
      gender: k.gender.toUpperCase(),
      address: k.address,
      district: k.district,
      city: k.city,
      lat: k.coordinates.lat,
      lng: k.coordinates.lng,
      ownerId: k.owner.id,
      electricityType: k.electricityType.toUpperCase(),
      privateAmenities: k.privateAmenities,
      sharedAmenities: k.sharedAmenities,
      studentDiscountAmount: k.studentDiscountAmount,
      applicationFee: fee,
      nearestCampusId: k.campusProximity.campusId,
      nearestCampusMeters: k.campusProximity.distanceMeters,
      createdAt: new Date(baseCreated.getTime() + ki * 60_000),
    })
    k.images.forEach((url, i) => imageRows.push({ id: `${k.id}-img-${i + 1}`, kosId: k.id, url, order: i }))
    k.rules.forEach((r) =>
      ruleRows.push({
        id: `${k.id}-rule-${r.id}`,
        kosId: k.id,
        tier: r.tier,
        categoryTitle: r.categoryTitle,
        rules: r.rules,
        penaltyAmount: r.penaltyAmount ?? null,
        penaltyClause: r.penaltyClause ?? null,
      }),
    )
    k.pois.forEach((p) => poiRows.push({ id: `${k.id}-${p.id}`, kosId: k.id, category: p.category, name: p.name, distanceMeters: p.distanceMeters, walkMinutes: p.walkMinutes, description: p.description }))

    // rooms from mock rows
    const kosRooms: RoomRow[] = []
    for (const r of k.rooms) {
      const row: RoomRow = { id: r.id, kosId: k.id, roomNumber: r.roomNumber, floor: r.floor, type: r.roomType, size: r.size, bedType: r.bedType, priceMonthly: r.priceMonthly, occupancy: 'VACANT' }
      kosRooms.push(row)
      if (r.status === 'vacant') continue
      const tenantId = `user-tenant-${r.id}`
      const campus = r.tenantCampus
      users.push({
        id: tenantId,
        name: (r.tenantName ?? 'Penyewa').replace(/\s*\(.*\)\s*$/, ''),
        email: `tenant-${r.id}@kobo.test`,
        emailVerified: true,
        phone: r.tenantPhone,
        campus,
        createdAt: baseCreated,
      })
      if (r.status === 'booking') addPendingTenancy(row, tenantId, fee)
      else addActiveTenancy(row, tenantId, r.status, r.daysOverdue ?? 3, fee)
    }

    // filler rooms up to totalRooms; enough vacant ones to reach availableRooms
    const vacantNow = kosRooms.filter((r) => r.occupancy === 'VACANT').length
    const fillerCount = Math.max(0, k.totalRooms - kosRooms.length)
    let fillerVacant = Math.max(0, Math.min(fillerCount, k.availableRooms - vacantNow))
    const used = new Set(kosRooms.map((r) => r.roomNumber))
    const templates = k.rooms
    const kosCampus = data.campuses.find((c) => c.id === k.campusProximity.campusId)?.shortName
    for (let i = 0; i < fillerCount; i++) {
      const t = templates[i % templates.length]
      let floor = 1 + (i % 3)
      let num = 10 + i
      while (used.has(`${floor}${num}`)) num++
      const roomNumber = `${floor}${num}`
      used.add(roomNumber)
      const price = i === 0 && Math.min(...templates.map((r) => r.priceMonthly)) > k.priceMonthlyStart ? k.priceMonthlyStart : t.priceMonthly
      const row: RoomRow = { id: `${k.id}-fill-${i + 1}`, kosId: k.id, roomNumber, floor, type: t.roomType, size: t.size, bedType: t.bedType, priceMonthly: price, occupancy: 'VACANT' }
      kosRooms.push(row)
      if (fillerVacant > 0) {
        fillerVacant--
        continue
      }
      const student = rng.pick(pool)
      student.campus ??= kosCampus
      addActiveTenancy(row, student.id, 'paid', 0, fee)
    }
    roomRows.push(...kosRooms)

    // ENDED tenancies + reviews so computed count/avg ~ mock card numbers
    const realReviews = data.reviews.filter((r) => r.kosId === k.id)
    const fillerReviews = Math.max(0, k.reviewCount - realReviews.length)
    const targetSum = Math.round(k.rating * k.reviewCount)
    const realSum = realReviews.reduce((s, r) => s + Math.round(r.ratingOverall), 0)
    const ratings: number[] = new Array(fillerReviews).fill(5)
    let deficit = 5 * fillerReviews - (targetSum - realSum)
    for (let guard = 0; deficit > 0 && guard < 10_000; guard++) {
      const i = rng.int(0, Math.max(0, ratings.length - 1))
      if (ratings[i] > 1) {
        ratings[i]--
        deficit--
      }
    }
    const clamp = (n: number) => Math.max(1, Math.min(5, n))
    const emit = (userId: string, rating: number, comment: string, subs: [number, number, number, number], reply?: string) => {
      const room = rng.pick(kosRooms)
      const id = `ten-${++seq}`
      const endedDays = rng.int(20, 300)
      const ended = addDays(today, -endedDays)
      const startDate = addMonths(ended, -6)
      tenancyRows.push({ id, roomId: room.id, userId, status: 'ENDED', startDate: atWIB(startDate), durationMonths: 6, endedAt: atWIB(ended), createdAt: atWIB(addDays(startDate, -2)) })
      reviewRows.push({
        id: `rev-${id}`,
        tenancyId: id,
        rating,
        cleanliness: subs[0],
        wifi: subs[1],
        ownerRating: subs[2],
        quietness: subs[3],
        comment,
        verifiedStudent: true,
        ownerReply: reply ?? null,
        ownerReplyAt: reply ? atWIB(addDays(ended, 1)) : null,
        createdAt: atWIB(addDays(ended, 2)),
      })
    }
    realReviews.forEach((r, i) => {
      const uid = `user-reviewer-${k.id}-${i + 1}`
      users.push({ id: uid, name: r.authorName, email: `reviewer-${k.id}-${i + 1}@kobo.test`, emailVerified: true, campus: r.authorCampus, createdAt: baseCreated })
      const s = r.subRatings
      emit(uid, clamp(Math.round(r.ratingOverall)), r.comment, [clamp(Math.round(s.cleanliness)), clamp(Math.round(s.wifi)), clamp(Math.round(s.owner)), clamp(Math.round(s.quietness))], r.ownerReply?.text)
    })
    ratings.forEach((rating) => {
      const s = (): number => clamp(rating + rng.int(-1, 0))
      emit(rng.pick(pool).id, rating, rng.pick(COMMENTS), [s(), s(), s(), s()])
    })
  })

  return {
    users,
    campuses,
    ownerProfiles,
    kos: kosRows as SeedRows['kos'],
    images: imageRows as SeedRows['images'],
    rules: ruleRows as SeedRows['rules'],
    pois: poiRows as SeedRows['pois'],
    rooms: roomRows,
    tenancies: tenancyRows as SeedRows['tenancies'],
    invoices: invoiceRows as SeedRows['invoices'],
    payments: paymentRows as SeedRows['payments'],
    reviews: reviewRows as SeedRows['reviews'],
  }
}

export async function seed(prisma: PrismaClient, opts: { now?: Date } = {}): Promise<void> {
  const d = buildSeed(opts.now ?? new Date())
  // Tenancies/Invoices/Payments reference users and rooms: insert parents first.
  await prisma.$transaction([
    prisma.user.createMany({ data: d.users as never }),
    prisma.campus.createMany({ data: d.campuses as never }),
    prisma.ownerProfile.createMany({ data: d.ownerProfiles as never }),
    prisma.kos.createMany({ data: d.kos as never }),
    prisma.kosImage.createMany({ data: d.images as never }),
    prisma.houseRule.createMany({ data: d.rules as never }),
    prisma.poi.createMany({ data: d.pois as never }),
    prisma.room.createMany({ data: d.rooms as never }),
    prisma.tenancy.createMany({ data: d.tenancies as never }),
    prisma.invoice.createMany({ data: d.invoices as never }),
    prisma.payment.createMany({ data: d.payments as never }),
    prisma.review.createMany({ data: d.reviews as never }),
  ])
}

/** TRUNCATE every app table (identity restarted) and reseed. Backs both tests and the demo reset. */
export async function resetDb(prisma: PrismaClient, opts: { now?: Date } = {}): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
  await seed(prisma, opts)
}
