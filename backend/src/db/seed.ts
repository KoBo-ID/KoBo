import { addDays, addMonths, todayWIB } from '@kobo/shared/domain'
import { itemsFromArrays } from '@kobo/shared/facilities'
import type { FacilityItem } from '@kobo/shared/facilities'
import { readFileSync } from 'node:fs'
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
type SeedInput = {
  campuses: { id: string; name: string; shortName: string; city: string; coordinates: { lat: number; lng: number } }[]
  kos: MockKos[]
  reviews: MockReview[]
}

/**
 * The bundled mock snapshot, or the file named by KOBO_SEED_FILE (a proposed seed in the same shape, e.g. one produced by the data job).
 * Off by default on purpose: tests and CI always use the bundled file. Read on every call so a test can switch it.
 */
function seedInput(): SeedInput {
  const file = process.env.KOBO_SEED_FILE
  return (file ? JSON.parse(readFileSync(file, 'utf8')) : rawData) as unknown as SeedInput
}

const EMAIL_DOMAINS: Record<string, string[]> = {
  'binus-syahdan': ['binus.ac.id'],
  'binus-anggrek': ['binus.ac.id'],
  'binus-kijang': ['binus.ac.id'],
  'ui-depok': ['ui.ac.id'],
  'itb-ganesha': ['itb.ac.id', 'students.itb.ac.id'],
  'ipb-dramaga': ['apps.ipb.ac.id'],
  'umn-gading-serpong': ['student.umn.ac.id'],
  'president-university': ['student.president.ac.id'],
  'undip-tembalang': ['students.undip.ac.id'],
  'ugm-bulaksumur': ['mail.ugm.ac.id'],
  'uns-kentingan': ['student.uns.ac.id'],
  'its-sukolilo': ['student.its.ac.id'],
  'ub-malang': ['student.ub.ac.id'],
  'untirta-serang': ['untirta.ac.id'],
  'unsil-tasikmalaya': ['student.unsil.ac.id'],
  'unsoed-purwokerto': ['mhs.unsoed.ac.id'],
  'uksw-salatiga': ['student.uksw.edu'],
  'unej-jember': ['mail.unej.ac.id'],
}

/** Curated student mail domains (research D). Only domains confirmed as student mail with an MX record; ui, untirta and unej stay empty. */
const STUDENT_EMAIL_DOMAINS: Record<string, string[]> = {
  'binus-syahdan': ['binus.ac.id'],
  'binus-anggrek': ['binus.ac.id'],
  'binus-kijang': ['binus.ac.id'],
  'itb-ganesha': ['students.itb.ac.id'],
  'ipb-dramaga': ['apps.ipb.ac.id'],
  'umn-gading-serpong': ['student.umn.ac.id'],
  'ugm-bulaksumur': ['mail.ugm.ac.id'],
  'uns-kentingan': ['student.uns.ac.id'],
  'its-sukolilo': ['student.its.ac.id'],
  'ub-malang': ['student.ub.ac.id'],
  'unsoed-purwokerto': ['student.unsoed.ac.id', 'mhs.unsoed.ac.id'],
  'undip-tembalang': ['students.undip.ac.id'],
  'president-university': ['student.president.ac.id'],
  'unsil-tasikmalaya': ['student.unsil.ac.id'],
  'uksw-salatiga': ['student.uksw.edu'],
}

/** Kampus Mitra is per institution: every campus whose parentId is listed here (any BINUS branch) gets the kos discount. */
export const AFFILIATED_CAMPUSES = [
  { campusId: 'binus', label: 'BINUS University' },
]

/** Branch campuses that belong to an institution on the Kampus Mitra list (parentId). */
const CAMPUS_PARENT: Record<string, string> = {
  'binus-syahdan': 'binus',
  'binus-anggrek': 'binus',
  'binus-kijang': 'binus',
}

/** Microsoft Entra tenant ids of campuses with a confirmed tenant. */
const BINUS_TENANT = '3485b963-82ba-4a6f-810f-b5cc226ff898'
const ENTRA_TENANT_IDS: Record<string, string[]> = {
  'binus-syahdan': [BINUS_TENANT],
  'binus-anggrek': [BINUS_TENANT],
  'binus-kijang': [BINUS_TENANT],
  'itb-ganesha': ['db6e1183-4c65-405c-82ce-7cd53fa6e9dc'],
  'undip-tembalang': ['03290435-ff74-45d1-aeaa-173677221cf8'],
  'its-sukolilo': ['1d5169ac-c7cb-4275-9764-bf8c9c364a4c'],
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

interface OwnerDocumentSeed {
  id: string
  userId: string
  kind: 'KTP' | 'SHM'
  key: string
  contentType: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  consentAt: Date
  createdAt: Date
  decidedAt?: Date
  reviewer?: string
  reason?: string | null
}

/** Everything the seed inserts, as plain rows. resetDemo() takes a slice of this instead of truncating. */
export interface SeedRows {
  users: { id: string; isDemo?: boolean; [k: string]: unknown }[]
  campuses: object[]
  ownerProfiles: { id: string; userId: string; [k: string]: unknown }[]
  ownerDocuments: OwnerDocumentSeed[]
  kos: { id: string; ownerId: string; [k: string]: unknown }[]
  images: { id: string; kosId: string }[]
  rules: { id: string; kosId: string }[]
  pois: { id: string; kosId: string }[]
  rooms: { id: string; kosId: string; occupancy: 'VACANT' | 'BOOKED' | 'OCCUPIED'; [k: string]: unknown }[]
  tenancies: { id: string; roomId: string; userId: string; status: 'PENDING' | 'ACTIVE' | 'ENDED'; [k: string]: unknown }[]
  invoices: { id: string; tenancyId: string; [k: string]: unknown }[]
  payments: { id: string; invoiceId: string; [k: string]: unknown }[]
  reviews: { id: string; tenancyId: string; [k: string]: unknown }[]
  /** Teman Sekamar: verified seeded students with profiles, plus the demo student's request, connection and chat. */
  matchingProfiles: { id: string; userId: string; [k: string]: unknown }[]
  partnerRequests: { id: string; fromUserId: string; toUserId: string; [k: string]: unknown }[]
  partnerConnections: { id: string; userAId: string; userBId: string; [k: string]: unknown }[]
  partnerMessages: { id: string; connectionId: string; [k: string]: unknown }[]
  connectionReadStates: { connectionId: string; userId: string; [k: string]: unknown }[]
}

interface Lifestyle {
  sleep: string
  tidiness: string
  smoking: string
  guests: string
  noise: string
  social: string
  study: string
  ac: string
  expenses: string
}
interface MatchSeedPerson {
  key: string
  name: string
  gender: 'LAKI_LAKI' | 'PEREMPUAN'
  birthYear: number
  campusId: string
  budget: [number, number]
  moveIn: string
  intro: string
  life: Lifestyle
}
const L = (sleep: string, tidiness: string, smoking: string, guests: string, noise: string, social: string, study: string, ac: string, expenses: string): Lifestyle => ({ sleep, tidiness, smoking, guests, noise, social, study, ac, expenses })

/** The demo student's own matching profile (Dimas, BINUS Syahdan). */
const DEMO_MATCH: MatchSeedPerson = {
  key: 'demo',
  name: 'Dimas',
  gender: 'LAKI_LAKI',
  birthYear: 2004,
  campusId: 'binus-syahdan',
  budget: [1_200_000, 2_200_000],
  moveIn: '2027-01-10',
  intro: 'Mahasiswa Teknik Informatika semester 3. Cari teman sekamar yang santai dan suka patungan wifi.',
  life: L('MALAM', 'CUKUP', 'TIDAK_MAU_PEROKOK', 'KADANG', 'SEDANG', 'SEIMBANG', 'CAMPUR', 'MALAM_SAJA', 'PATUNGAN'),
}
const MATCH_PEOPLE: MatchSeedPerson[] = [
  { key: 'bayu', name: 'Bayu', gender: 'LAKI_LAKI', birthYear: 2003, campusId: 'binus-syahdan', budget: [1_000_000, 1_800_000], moveIn: '2027-01-05', intro: 'Anak rantau dari Lampung, jurusan Sistem Informasi. Jarang di kos kalau siang.', life: L('NORMAL', 'RAPI', 'TIDAK_MAU_PEROKOK', 'JARANG', 'TENANG', 'INTROVERT', 'DI_LUAR', 'SELALU', 'PATUNGAN') },
  { key: 'rizky', name: 'Rizky', gender: 'LAKI_LAKI', birthYear: 2004, campusId: 'binus-anggrek', budget: [1_500_000, 2_500_000], moveIn: '2027-01-15', intro: 'Suka main gitar, tapi tahu waktu. Bisa bagi tugas bersih-bersih.', life: L('MALAM', 'CUKUP', 'TIDAK_MEROKOK_TOLERAN', 'SERING', 'RAMAI', 'EKSTROVERT', 'DI_KAMAR', 'MALAM_SAJA', 'SEBAGIAN') },
  { key: 'fajar', name: 'Fajar', gender: 'LAKI_LAKI', birthYear: 2002, campusId: 'binus-syahdan', budget: [900_000, 1_500_000], moveIn: '2027-02-01', intro: 'Semester akhir, lagi skripsi. Butuh kamar yang tenang dan bebas rokok.', life: L('AWAL', 'RAPI', 'TIDAK_MAU_PEROKOK', 'JARANG', 'TENANG', 'INTROVERT', 'DI_KAMAR', 'TANPA_AC', 'TERPISAH') },
  { key: 'kevin', name: 'Kevin', gender: 'LAKI_LAKI', birthYear: 2005, campusId: 'binus-kijang', budget: [1_300_000, 2_000_000], moveIn: '2027-01-20', intro: 'Mahasiswa baru DKV. Santai, suka nonton dan masak mi bareng.', life: L('MALAM', 'SANTAI', 'BEBAS', 'KADANG', 'SEDANG', 'SEIMBANG', 'CAMPUR', 'SELALU', 'PATUNGAN') },
  { key: 'agus', name: 'Agus', gender: 'LAKI_LAKI', birthYear: 2003, campusId: 'binus-anggrek', budget: [1_100_000, 1_900_000], moveIn: '2027-01-08', intro: 'Aktif di UKM basket, sering pulang malam. Tidak mengganggu kalau tidur.', life: L('MALAM', 'CUKUP', 'TIDAK_MEROKOK_TOLERAN', 'KADANG', 'SEDANG', 'EKSTROVERT', 'DI_LUAR', 'MALAM_SAJA', 'SEBAGIAN') },
  { key: 'yoga', name: 'Yoga', gender: 'LAKI_LAKI', birthYear: 2004, campusId: 'binus-syahdan', budget: [1_400_000, 2_300_000], moveIn: '2027-03-01', intro: 'Ngoding sampai larut, tapi pakai headset. Suka kamar rapi.', life: L('MALAM', 'RAPI', 'TIDAK_MAU_PEROKOK', 'JARANG', 'TENANG', 'INTROVERT', 'DI_KAMAR', 'SELALU', 'PATUNGAN') },
  { key: 'salsa', name: 'Salsabila', gender: 'PEREMPUAN', birthYear: 2004, campusId: 'binus-syahdan', budget: [1_300_000, 2_200_000], moveIn: '2027-01-12', intro: 'Jurusan Akuntansi. Rajin bangun pagi, suka kamar bersih dan wangi.', life: L('AWAL', 'RAPI', 'TIDAK_MAU_PEROKOK', 'KADANG', 'TENANG', 'SEIMBANG', 'CAMPUR', 'SELALU', 'PATUNGAN') },
  { key: 'putri', name: 'Putri Ayu', gender: 'PEREMPUAN', birthYear: 2003, campusId: 'binus-anggrek', budget: [1_000_000, 1_700_000], moveIn: '2027-02-10', intro: 'Dari Medan, semester 5 Manajemen. Ramah dan gampang cocok.', life: L('NORMAL', 'CUKUP', 'TIDAK_MAU_PEROKOK', 'SERING', 'SEDANG', 'EKSTROVERT', 'DI_LUAR', 'MALAM_SAJA', 'SEBAGIAN') },
]

/** Builds the matching rows and pushes the extra verified students onto `users`. Deterministic for a given `now`. */
function buildMatchingSeed(
  now: Date,
  baseCreated: Date,
  coords: (campusId: string) => { lat: number; lng: number } | undefined,
  users: { id: string }[],
): Pick<SeedRows, 'matchingProfiles' | 'partnerRequests' | 'partnerConnections' | 'partnerMessages' | 'connectionReadStates'> {
  const DAYS = 86_400_000
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const campusName: Record<string, string> = { 'binus-syahdan': 'BINUS Syahdan', 'binus-anggrek': 'BINUS Anggrek', 'binus-kijang': 'BINUS Kijang' }
  const uid = (p: MatchSeedPerson) => (p.key === 'demo' ? 'user-demo-student' : `user-match-${p.key}`)
  const profiles = [DEMO_MATCH, ...MATCH_PEOPLE].map((p) => {
    const userId = uid(p)
    if (p.key !== 'demo') {
      users.push({
        id: userId,
        name: `${p.name} ${p.gender === 'LAKI_LAKI' ? 'Saputra' : 'Lestari'}`,
        email: `match-${p.key}@kobo.test`,
        emailVerified: true,
        campus: campusName[p.campusId],
        campusEmailVerifiedAt: baseCreated,
        campusVerifiedVia: 'KTM',
        campusVerifiedUntil: new Date(now.getTime() + 365 * DAYS),
        verifiedCampusId: p.campusId,
        createdAt: baseCreated,
      } as { id: string })
    }
    const c = coords(p.campusId) ?? { lat: -6.2, lng: 106.78 }
    return {
      id: `match-profile-${p.key}`,
      userId,
      createdAt: baseCreated,
      displayName: p.name,
      intro: p.intro,
      gender: p.gender,
      birthYear: p.birthYear,
      campusId: p.campusId,
      active: true,
      lastActiveAt: now,
      budgetMin: p.budget[0],
      budgetMax: p.budget[1],
      anchorLat: c.lat,
      anchorLng: c.lng,
      anchorLabel: campusName[p.campusId] ?? 'Kampus',
      radiusKm: 3,
      moveInDate: new Date(`${p.moveIn}T00:00:00Z`),
      durationMonths: 12,
      kosType: p.gender === 'LAKI_LAKI' ? 'PUTRA' : 'PUTRI',
      roomShare: 2,
      ...p.life,
    }
  })

  const demoId = 'user-demo-student'
  // One request waiting for the demo student (from Bayu), one accepted request that became a live connection (Fajar).
  const partnerRequests = [
    { id: 'match-req-pending', fromUserId: 'user-match-bayu', toUserId: demoId, message: 'Halo Dimas, kita sama-sama di Syahdan dan budget mirip. Mau coba cocokkan?', status: 'PENDING', createdAt: ago(1 * DAYS), expiresAt: new Date(now.getTime() + 13 * DAYS) },
    { id: 'match-req-accepted', fromUserId: demoId, toUserId: 'user-match-fajar', message: 'Halo Fajar, saya juga cari kamar tenang untuk semester depan.', status: 'ACCEPTED', createdAt: ago(5 * DAYS), expiresAt: new Date(now.getTime() + 9 * DAYS), decidedAt: ago(4 * DAYS) },
  ]
  const [a, b] = demoId < 'user-match-fajar' ? [demoId, 'user-match-fajar'] : ['user-match-fajar', demoId]
  const partnerConnections = [{ id: 'match-conn-1', userAId: a, userBId: b, requestId: 'match-req-accepted', createdAt: ago(4 * DAYS) }]
  const chat: [string, string, number][] = [
    ['user-match-fajar', 'Makasih sudah diterima ya. Kamu biasanya kuliah jam berapa?', 4 * DAYS - 600_000],
    [demoId, 'Sama-sama. Biasanya siang, tapi kadang ada kelas pagi.', 4 * DAYS - 3_600_000],
    ['user-match-fajar', 'Oke cocok. Aku lagi skripsi jadi lebih banyak di kamar, nggak masalah?', 3 * DAYS],
    [demoId, 'Nggak masalah, aku pakai headset kalau ngoding. Mau lihat kos bareng minggu ini?', 3 * DAYS - 3_600_000],
    ['user-match-fajar', 'Boleh, nanti kita lihat dua kos dekat Syahdan bareng.', 2 * DAYS],
  ]
  const partnerMessages = chat.map(([senderId, body, agoMs], i) => ({ id: `match-msg-${i + 1}`, connectionId: 'match-conn-1', senderId, body, createdAt: ago(agoMs) }))
  // The demo student has read everything except Fajar's last message. lastDigestAt is set so the worker does not mail the demo address about it.
  const connectionReadStates = [
    { connectionId: 'match-conn-1', userId: demoId, lastReadAt: ago(2 * DAYS + 3_600_000), lastDigestAt: now },
    { connectionId: 'match-conn-1', userId: 'user-match-fajar', lastReadAt: now },
  ]
  return { matchingProfiles: profiles, partnerRequests, partnerConnections, partnerMessages, connectionReadStates }
}

export function buildSeed(now: Date): SeedRows {
  const data = seedInput()
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
    parentId: CAMPUS_PARENT[c.id] ?? null,
    studentEmailDomains: STUDENT_EMAIL_DOMAINS[c.id] ?? [],
    entraTenantIds: ENTRA_TENANT_IDS[c.id] ?? [],
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
    campusVerifiedVia?: 'EMAIL' | 'MICROSOFT' | 'GOOGLE' | 'KTM' | 'SHEERID'
    campusVerifiedUntil?: Date
    verifiedCampusId?: string
    isDemo?: boolean
    createdAt: Date
  }
  const users: UserRow[] = []
  const baseCreated = new Date('2026-01-01T00:00:00Z')

  const owners = new Map<string, MockKos['owner']>()
  for (const k of data.kos) owners.set(k.owner.id, k.owner)
  const ownerProfiles: SeedRows['ownerProfiles'] = [...owners.values()].map((o, i) => {
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
      approvedAt: baseCreated,
      verificationStatus: 'DISETUJUI',
      responseRate: o.responseRate,
      memberSince: parseMemberSince(o.memberSince),
    }
  })

  // Two owners still in the document workflow, for the admin review queue and the owner status UI. They have no kos, and
  // their OwnerDocument keys are fake: no file exists in storage behind them.
  const ownerDocuments: OwnerDocumentSeed[] = []
  const pendingOwners = [
    { id: 'owner-sample-menunggu', name: 'Hendra Kusuma', status: 'MENUNGGU', docStatus: 'PENDING', reason: null },
    { id: 'owner-sample-ditolak', name: 'Sari Wulandari', status: 'DITOLAK', docStatus: 'REJECTED', reason: 'KTP_BURAM' },
  ] as const
  for (const p of pendingOwners) {
    users.push({ id: `user-${p.id}`, name: p.name, email: `${p.id}@kobo.test`, emailVerified: true, phone: '081200000000', createdAt: baseCreated })
    ownerProfiles.push({
      id: p.id,
      userId: `user-${p.id}`,
      verificationStatus: p.status,
      verificationReason: p.status === 'DITOLAK' ? 'Foto KTP buram atau tidak terbaca. Unggah ulang KTP dengan foto yang jelas.' : null,
      verificationAttempts: 1,
      ownershipType: 'PEMILIK',
      ownershipDeclaredAt: baseCreated,
      memberSince: baseCreated,
    })
    for (const kind of ['KTP', 'SHM'] as const) {
      ownerDocuments.push({
        id: `ownerdoc-${p.id}-${kind.toLowerCase()}`,
        userId: `user-${p.id}`,
        kind,
        key: `owner-docs/seed/${p.id}/${kind.toLowerCase()}.jpg`,
        contentType: 'image/jpeg',
        status: p.status === 'DITOLAK' && kind === 'KTP' ? p.docStatus : p.status === 'DITOLAK' ? 'PENDING' : p.docStatus,
        consentAt: baseCreated,
        createdAt: baseCreated,
        ...(p.status === 'DITOLAK' && kind === 'KTP' ? { decidedAt: baseCreated, reviewer: 'seed', reason: p.reason } : {}),
      })
    }
  }

  users.push({
    id: 'user-demo-student',
    name: 'Dimas Pratama',
    email: DEMO_EMAILS.student,
    emailVerified: true,
    campus: 'Binus Syahdan',
    campusEmail: 'dimas.pratama@binus.ac.id',
    campusEmailVerifiedAt: baseCreated,
    campusVerifiedVia: 'EMAIL',
    // From the real "now", not baseCreated: the seed dates are fixed in the past and the demo student must stay verified.
    campusVerifiedUntil: new Date(now.getTime() + 365 * 86_400_000),
    verifiedCampusId: 'binus-syahdan',
    isDemo: true,
    createdAt: baseCreated,
  })

  // Verified, but at a campus that is NOT on the Kampus Mitra list: sees the discount as "tidak berlaku".
  const nonAffiliatedCampus = data.campuses.find((c) => c.id === 'ui-depok') ?? data.campuses.find((c) => !AFFILIATED_CAMPUSES.some((a) => a.campusId === c.id))
  if (nonAffiliatedCampus) {
    users.push({
      id: 'user-student-non-mitra',
      name: 'Rafi Ananda',
      email: 'rafi.ananda@kobo.test',
      emailVerified: true,
      campus: nonAffiliatedCampus.shortName,
      campusEmailVerifiedAt: baseCreated,
      campusVerifiedVia: 'KTM',
      campusVerifiedUntil: new Date(now.getTime() + 365 * 86_400_000),
      verifiedCampusId: nonAffiliatedCampus.id,
      createdAt: baseCreated,
    })
  }

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
    maxOccupants?: number
    pricePerPersonMonthly?: number
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
      const applicationFeeAmount = m === 0 ? kosFee : 0
      invoiceRows.push({
        id: invId,
        tenancyId: id,
        periodStart: dateOnly(due),
        dueDate: dateOnly(due),
        amount: room.priceMonthly + applicationFeeAmount,
        rentAmount: room.priceMonthly,
        discountAmount: 0,
        applicationFeeAmount,
        ownerReceivableAmount: room.priceMonthly,
        gatewayFeeBearer: 'PLATFORM',
        status: paid ? 'PAID' : 'UNPAID',
      })
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
    invoiceRows.push({
      id: invId,
      tenancyId: id,
      periodStart: dateOnly(addDays(today, 7)),
      dueDate: dateOnly(addDays(today, 7)),
      amount: room.priceMonthly + kosFee,
      rentAmount: room.priceMonthly,
      discountAmount: 0,
      applicationFeeAmount: kosFee,
      ownerReceivableAmount: room.priceMonthly,
      gatewayFeeBearer: 'PLATFORM',
      status: 'UNPAID',
    })
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
      floors: Math.max(1, ...k.rooms.map((r) => r.floor)),
      ...(ki === 0 ? { yearBuilt: 2019, buildingAreaM2: 320, facilities: richFacilities(k.privateAmenities, k.sharedAmenities) } : {}),
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
    // Shareable rooms near the BINUS campuses, so "Cari kos bersama" has results in the demo: the first vacant rooms fit 2-3 people,
    // two of the three with a per-person price (the other is priced per room only).
    if (k.campusProximity.campusId.startsWith('binus-')) {
      kosRooms
        .filter((r) => r.occupancy === 'VACANT')
        .slice(0, 3)
        .forEach((r, i) => {
          r.maxOccupants = i === 2 ? 3 : 2
          if (i !== 1) r.pricePerPersonMonthly = Math.max(50_000, Math.round((r.priceMonthly * 0.6) / 50_000) * 50_000)
        })
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

  // ---- Teman Sekamar demo data: verified students at the BINUS campuses; the demo student gets a profile, one pending
  // request and one live connection with a short chat (both counterparts are seeded students, never the demo).
  const matching = buildMatchingSeed(now, baseCreated, (id) => data.campuses.find((c) => c.id === id)?.coordinates, users)

  return {
    users,
    campuses,
    ownerProfiles,
    ownerDocuments,
    kos: kosRows as SeedRows['kos'],
    images: imageRows as SeedRows['images'],
    rules: ruleRows as SeedRows['rules'],
    pois: poiRows as SeedRows['pois'],
    rooms: roomRows,
    tenancies: tenancyRows as SeedRows['tenancies'],
    invoices: invoiceRows as SeedRows['invoices'],
    payments: paymentRows as SeedRows['payments'],
    reviews: reviewRows as SeedRows['reviews'],
    ...matching,
  }
}

export async function seed(prisma: PrismaClient, opts: { now?: Date } = {}): Promise<void> {
  const d = buildSeed(opts.now ?? new Date())
  // Tenancies/Invoices/Payments reference users and rooms: insert parents first.
  await prisma.$transaction([
    prisma.user.createMany({ data: d.users as never }),
    prisma.campus.createMany({ data: d.campuses as never, skipDuplicates: true }),
    prisma.campusAffiliation.createMany({ data: AFFILIATED_CAMPUSES, skipDuplicates: true }),
    prisma.ownerProfile.createMany({ data: d.ownerProfiles as never }),
    prisma.ownerDocument.createMany({ data: d.ownerDocuments as never }),
    prisma.kos.createMany({ data: d.kos as never }),
    prisma.kosImage.createMany({ data: d.images as never }),
    prisma.houseRule.createMany({ data: d.rules as never }),
    prisma.poi.createMany({ data: d.pois as never }),
    prisma.room.createMany({ data: d.rooms as never }),
    prisma.tenancy.createMany({ data: d.tenancies as never }),
    prisma.invoice.createMany({ data: d.invoices as never }),
    prisma.payment.createMany({ data: d.payments as never }),
    prisma.review.createMany({ data: d.reviews as never }),
    prisma.matchingProfile.createMany({ data: d.matchingProfiles as never }),
    prisma.partnerRequest.createMany({ data: d.partnerRequests as never }),
    prisma.partnerConnection.createMany({ data: d.partnerConnections as never }),
    prisma.partnerMessage.createMany({ data: d.partnerMessages as never }),
    prisma.connectionReadState.createMany({ data: d.connectionReadStates as never }),
  ])
}

/** TRUNCATE every app table (identity restarted) and reseed. Backs both tests and the demo reset. */
/** The first seeded kos shows what a fully filled building looks like: notes, a paid service and a parking fee. */
function richFacilities(priv: string[], shared: string[]): FacilityItem[] {
  const notes: [RegExp, Partial<FacilityItem>][] = [
    [/wi-?fi/i, { note: 'Fiber, stabil untuk kuliah daring' }],
    [/parkir/i, { note: 'Motor 15 unit, mobil 2 unit' }],
    [/cuci/i, { status: 'PAID', fee: 5000, note: 'Per cucian, token di mesin' }],
    [/cctv/i, { note: 'Aktif 24 jam' }],
  ]
  return itemsFromArrays(priv, shared).map((item) => ({ ...item, ...(notes.find(([re]) => re.test(item.label))?.[1] ?? {}) }))
}

/**
 * Reference data loaded by `catalog:import` (ADR 0016). resetDb must never wipe it: it is rebuilt only by an import, and
 * nothing in the app references it with a foreign key, so excluding it from the TRUNCATE list is enough (a CASCADE only
 * follows foreign keys *to* truncated tables). Campus holds both seeded rows and imported rows: only the seeded ones
 * (dataVersion IS NULL) are replaced.
 */
export const REFERENCE_TABLES = ['Region', 'PlaceCatalog', 'CatalogMeta', 'Campus'] as const

export async function resetDb(prisma: PrismaClient, opts: { now?: Date } = {}): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  const list = tables
    .filter((t) => !(REFERENCE_TABLES as readonly string[]).includes(t.tablename))
    .map((t) => `"public"."${t.tablename}"`)
    .join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
  // Kos rows are gone, so no foreign key points at a seeded campus any more.
  await prisma.$executeRaw`DELETE FROM "Campus" WHERE "dataVersion" IS NULL`
  await seed(prisma, opts)
}
