// Zod schemas. Server and lazy routes only (never import from the landing chunk).
import { z } from 'zod'
import { MAX_ROOMS_PER_KOS } from './limits.ts'
import { isCalendarDay } from './domain/calendarDay.ts'
import { MAX_LEASE_MONTHS } from './domain/pricing.ts'
import { containsContactInfo, LIFESTYLE_VALUES, MATCH_GENDERS, MATCH_KOS_TYPES } from './domain/matching.ts'
import { GENDER_FILTERS, PRICE_MAX, SEARCH_RADIUS_MAX, SEARCH_RADIUS_MIN, SORT_KEYS } from './search.ts'

/** 'YYYY-MM-DD' that exists on the calendar. */
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDay, { message: 'Tanggal tidak valid.' })

export const kosListInput = z.object({ limit: z.number().int().min(1).max(200).optional() }).optional()
export type KosListInput = z.infer<typeof kosListInput>

/** Mirrors the Search page filters. With lat/lng, only kos within 5 km of that point are returned. */
export const kosSearchInput = z
  .object({
    q: z.string().trim().max(100).default(''),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    /** Search radius around lat/lng in metres; omitted means SEARCH_RADIUS_METERS. Ignored without lat/lng. */
    radius: z.number().int().min(SEARCH_RADIUS_MIN).max(SEARCH_RADIUS_MAX).optional(),
    /** Display label of the reference point. Not used for filtering. */
    locationLabel: z.string().max(80).optional(),
    /** Kemendagri region code at any level ("36", "36.74", "36.74.03", "36.74.03.1001"): kos inside that area. */
    regionCode: z.string().regex(/^\d{2}(\.\d{2}){0,2}(\.\d{4})?$/).optional(),
    gender: z.enum(GENDER_FILTERS).default('all'),
    /** At PRICE_MAX the price filter is off (kos above it still show). */
    maxPrice: z.number().int().min(0).default(PRICE_MAX),
    discountOnly: z.boolean().default(false),
    surveyOnly: z.boolean().default(false),
    sort: z.enum(SORT_KEYS).default('rating'),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), { message: 'lat dan lng harus diisi bersamaan.', path: ['lat'] })
export type KosSearchInput = z.input<typeof kosSearchInput>

export const idInput = z.object({ id: z.string().min(1).max(64) })

export const bookingCreateInput = z.object({
  roomId: z.string().min(1).max(64),
  /** 'YYYY-MM-DD' (WIB calendar day). The server rejects dates in the past. */
  startDate: calendarDay,
  durationMonths: z.number().int().min(1).max(MAX_LEASE_MONTHS),
})
export type BookingCreateInput = z.input<typeof bookingCreateInput>

export const rentalApplicationCreateInput = bookingCreateInput.extend({
  program: z.string().trim().max(80).optional(),
  semester: z.number().int().min(1).max(14).optional(),
  note: z.string().trim().max(500).optional(),
})

/** Image MIME types accepted directly for private document uploads (KTM, owner KTP/land docs). SVG is never allowed. */
export const DOCUMENT_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'image/bmp'] as const
export type DocumentImageContentType = (typeof DOCUMENT_IMAGE_CONTENT_TYPES)[number]
export const OWNER_DOC_CONTENT_TYPES = [...DOCUMENT_IMAGE_CONTENT_TYPES, 'application/pdf'] as const
export type OwnerDocContentType = (typeof OWNER_DOC_CONTENT_TYPES)[number]

/** KTM upload: the student's card photo goes to private storage. */
export const ktmPresignInput = z.object({
  contentType: z.enum(DOCUMENT_IMAGE_CONTENT_TYPES),
  contentLength: z.number().int().min(1).max(3_000_000),
})
/** SheerID (dev/test only): the student picks a campus and gives the separate cross-border transfer consent. */
export const sheeridStartInput = z.object({
  campusId: z.string().min(1),
  consent: z.literal(true),
})
export type SheeridStartInput = z.infer<typeof sheeridStartInput>

export const ktmConfirmInput = z.object({
  key: z.string(),
  campusId: z.string().min(1),
  nim: z.string().trim().min(3).max(30),
  nameOnCard: z.string().trim().min(2).max(80),
  /** The expiry printed on the card, typed by the student; the reviewer decides the real validUntil. */
  validUntil: calendarDay.optional(),
  program: z.string().trim().max(80).optional(),
  consent: z.literal(true),
})
export const campusEmailCodeInput = z.object({ code: z.string().regex(/^\d{6}$/) })

export const APPLICATION_DECISION_REASONS = [
  'KAMAR_TIDAK_TERSEDIA',
  'MEMILIH_PENGAJU_LAIN',
  'TANGGAL_TIDAK_COCOK',
  'LAINNYA',
] as const
export const APPLICATION_DECISION_REASON_LABEL: Record<(typeof APPLICATION_DECISION_REASONS)[number], string> = {
  KAMAR_TIDAK_TERSEDIA: 'Kamar tidak tersedia', // COPY: reviewed (part 2)
  MEMILIH_PENGAJU_LAIN: 'Memilih pengaju lain', // COPY: reviewed (part 2)
  TANGGAL_TIDAK_COCOK: 'Tanggal mulai tidak cocok', // COPY: reviewed (part 2)
  LAINNYA: 'Alasan lain', // COPY: reviewed (part 2)
}
/** The sentence the student reads (email and card). Must match frontend/src/lib/decisionReason.ts. */
export const APPLICATION_DECISION_REASON_STUDENT_TEXT: Record<(typeof APPLICATION_DECISION_REASONS)[number], string> = {
  KAMAR_TIDAK_TERSEDIA: 'Kamar ini tidak tersedia untuk tanggal yang Anda ajukan.', // COPY: reviewed (part 2)
  MEMILIH_PENGAJU_LAIN: 'Pemilik menerima pengajuan lain untuk kamar ini.', // COPY: reviewed (part 2)
  TANGGAL_TIDAK_COCOK: 'Tanggal mulai sewa yang Anda ajukan tidak cocok untuk pemilik.', // COPY: reviewed (part 2)
  LAINNYA: 'Pemilik menolak dengan alasan lain.', // COPY: reviewed (part 2)
}

export const rentalApplicationDecisionInput = z.object({
  kosId: z.string().min(1).max(64),
  applicationId: z.string().min(1).max(64),
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.enum(APPLICATION_DECISION_REASONS).optional(),
  note: z.string().trim().max(200).optional(),
})

export const paymentIdInput = z.object({ paymentId: z.string().min(1).max(64) })
export const invoiceIdInput = z.object({ invoiceId: z.string().min(1).max(64) })

/** `kosId` is required by ownerProcedure (the authorization root); the invoice must belong to that kos. */
export const manualPaymentMethod = z.enum(['CASH', 'BANK_TRANSFER'])
export const recordManualInput = z
  .object({
    kosId: z.string().min(1).max(64),
    invoiceId: z.string().min(1).max(64),
    method: manualPaymentMethod,
    /** The owner re-types what they received; the server compares it with the invoice after locking it. */
    confirmedAmount: z.number().int().min(1),
    reference: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[A-Za-z0-9 ./_-]+$/, 'Nomor referensi hanya boleh huruf, angka, spasi, titik, garis miring, garis bawah, atau tanda hubung.')
      .optional(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.method === 'BANK_TRANSFER' && !v.reference) ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Nomor referensi transfer wajib diisi.' })
    if (v.method === 'CASH' && v.reference) ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Pembayaran tunai tidak memakai nomor referensi.' })
  })

// ---------------------------------------------------------------------------
// Owner workspace (spec sections 3 and 5). Every owner write carries `kosId`, the authorization root.
// ---------------------------------------------------------------------------

/** Registering as an owner: the WhatsApp number tenants and KoBo reach the owner on. */
export const OWNERSHIP_TYPES = ['PEMILIK', 'PENGELOLA_KUASA', 'LAINNYA'] as const
export const ownerRegisterInput = z.object({
  phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{7,18}$/, 'Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890.'),
  /** Self-declared, optional, not verified: the owner, a manager with a power of attorney, or something else. */
  ownershipType: z.enum(OWNERSHIP_TYPES).optional(),
})

export { MAX_ROOMS_PER_KOS, MAX_KOS_PER_OWNER } from './limits.ts'

const text = (max: number) => z.string().trim().min(1).max(max)
/** Rent price: at least Rp 1 (B-08). Deposits and fees use their own min(0) fields. */
const rupiah = z.number().int().min(1).max(50_000_000)

export const kosIdOnly = z.object({ kosId: z.string().min(1).max(64) })

export const facilityItemInput = z.object({
  label: text(60),
  scope: z.enum(['KAMAR', 'GEDUNG']),
  group: z.enum(['KAMAR', 'KEAMANAN', 'PARKIR', 'UTILITAS', 'LAYANAN', 'DAPUR', 'LAINNYA']),
  status: z.enum(['INCLUDED', 'PAID']),
  fee: z.number().int().min(0).max(10_000_000).nullable().optional(),
  note: z.string().trim().max(80).optional(),
})

/** The kos fields the owner form edits. `applicationFee` stays untouched when omitted. */
export const kosFieldsInput = z.object({
  name: text(100),
  gender: z.enum(['CAMPUR', 'PUTRA', 'PUTRI']),
  address: text(200),
  district: text(80),
  city: text(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  electricityType: z.enum(['INCLUDED', 'TOKEN']),
  /** Flat lists, used when `facilities` is omitted. With `facilities` the server derives both from it. */
  privateAmenities: z.array(text(60)).max(30).default([]),
  sharedAmenities: z.array(text(60)).max(30).default([]),
  facilities: z.array(facilityItemInput).max(60).optional(),
  floors: z.number().int().min(1).max(60).optional(),
  yearBuilt: z.number().int().min(1900).max(2100).optional(),
  buildingAreaM2: z.number().int().min(1).max(100_000).optional(),
  studentDiscountAmount: z.number().int().min(0).max(5_000_000),
  applicationFee: z.number().int().min(0).max(1_000_000).optional(),
})

/** Creating a kos has no `kosId` yet, so it uses owner-only auth (an OwnerProfile) instead of ownerProcedure. */
export const kosCreateInput = kosFieldsInput.extend({
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\/\S+$/i.test(v), 'URL foto tidak valid')
    .optional(),
  /** Optional starter rooms, all vacant: spread over `floors` when given (numbered 101, 102, ... 201 ...), else 4 per floor. */
  initialRooms: z.object({ count: z.number().int().min(1).max(MAX_ROOMS_PER_KOS), priceMonthly: rupiah }).optional(),
})
export type KosCreateInput = z.input<typeof kosCreateInput>

export const kosUpdateInput = kosFieldsInput.extend({ kosId: z.string().min(1).max(64) })
export type KosUpdateInput = z.input<typeof kosUpdateInput>

export const roomFieldsInput = z.object({
  roomNumber: text(20),
  floor: z.number().int().min(1).max(60),
  type: text(60),
  size: text(30),
  bedType: text(60),
  priceMonthly: rupiah,
  /** People the room fits, 1..4. Omitted keeps the current value (1 for a new room: never offered as shareable). */
  maxOccupants: z.number().int().min(1).max(4).optional(),
  /** Price per person when shared; null clears it. */
  pricePerPersonMonthly: rupiah.nullable().optional(),
})
export const roomCreateInput = roomFieldsInput.extend({ kosId: z.string().min(1).max(64) })
export const roomUpdateInput = roomFieldsInput.extend({ kosId: z.string().min(1).max(64), roomId: z.string().min(1).max(64) })
export const roomDeleteInput = z.object({ kosId: z.string().min(1).max(64), roomId: z.string().min(1).max(64) })
export type RoomFieldsInput = z.input<typeof roomFieldsInput>

export const houseRuleInput = z.object({
  categoryTitle: text(60),
  rules: z.array(text(140)).min(1).max(15),
  penaltyAmount: z.number().int().min(0).max(10_000_000).optional(),
  penaltyClause: z.string().trim().max(300).optional(),
})
export const rulesSetInput = z.object({ kosId: z.string().min(1).max(64), groups: z.array(houseRuleInput).max(10) })

export const tenancyEndPreviewInput = z.object({
  kosId: z.string().min(1).max(64),
  tenancyId: z.string().min(1).max(64),
})

export const tenancyEndInput = z
  .object({
    kosId: z.string().min(1).max(64),
    tenancyId: z.string().min(1).max(64),
    arrears: z.enum(['KEEP', 'WAIVE']).optional(),
    waiverReason: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.arrears === 'WAIVE' && (v.waiverReason?.length ?? 0) < 5) {
      ctx.addIssue({
        code: 'custom',
        path: ['waiverReason'],
        message: 'Alasan penghapusan tunggakan wajib diisi minimal 5 karakter.', // COPY: reviewed (part 2)
      })
    }
  })

/** The number in /kuitansi/:receiptNo (the raw Payment.receiptNo). */
export const kuitansiGetInput = z.object({ receiptNo: z.number().int().min(1).max(2_000_000_000) })

// ---------------------------------------------------------------------------
// Reviews (spec section 3) and photo uploads (spec section 9)
// ---------------------------------------------------------------------------

const rating = z.number().int().min(1).max(5)
export const reviewSubRatingsInput = z
  .object({ cleanliness: rating.optional(), wifi: rating.optional(), owner: rating.optional(), quietness: rating.optional() })
  .default({})
export const reviewFieldsInput = z.object({
  rating,
  subRatings: reviewSubRatingsInput,
  comment: z.string().trim().min(1).max(1500),
})
export const reviewCreateInput = reviewFieldsInput.extend({ tenancyId: z.string().min(1).max(64) })
export const reviewUpdateInput = reviewFieldsInput.extend({ reviewId: z.string().min(1).max(64) })
export type ReviewCreateInput = z.input<typeof reviewCreateInput>

export const reviewReplyInput = z.object({
  kosId: z.string().min(1).max(64),
  reviewId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(1000),
})

/** Photos: WebP (JPEG as a fallback), at most 2 MB each. */
export const IMAGE_CONTENT_TYPES = ['image/webp', 'image/jpeg'] as const
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const IMAGE_MAX_PER_KOS = 12

export const imagePresignInput = z.object({
  kosId: z.string().min(1).max(64),
  contentType: z.enum(IMAGE_CONTENT_TYPES),
  contentLength: z.number().int().min(1).max(IMAGE_MAX_BYTES),
  width: z.number().int().min(100).max(4000),
  /** Groups the 800 px and 1600 px variants of one photo (same uuid in both keys). The server generates one when omitted. */
  baseId: z.uuid().optional(),
})
export const imageConfirmInput = z.object({
  kosId: z.string().min(1).max(64),
  key: z.string().min(1).max(200),
  width: z.number().int().min(100).max(4000),
  height: z.number().int().min(1).max(8000),
  order: z.number().int().min(0).max(100),
})
export const imageDeleteInput = z.object({ kosId: z.string().min(1).max(64), imageId: z.string().min(1).max(64) })
export const imageReorderInput = z.object({ kosId: z.string().min(1).max(64), imageIds: z.array(z.string().min(1).max(64)).min(1).max(IMAGE_MAX_PER_KOS * 2) })

// ---------------------------------------------------------------------------
// Free survey visits
// ---------------------------------------------------------------------------

export const VISIT_SLOTS = ['PAGI', 'SIANG'] as const
export const visitCreateInput = z.object({
  kosId: z.string().min(1).max(64),
  /** 'YYYY-MM-DD' (WIB calendar day), strictly after today in WIB. */
  date: calendarDay,
  timeSlot: z.enum(VISIT_SLOTS),
  notes: z.string().trim().max(300).optional(),
})
export type VisitCreateInput = z.input<typeof visitCreateInput>
export const visitIdInput = z.object({ visitId: z.string().min(1).max(64) })
export const visitCompleteInput = z.object({ kosId: z.string().min(1).max(64), visitId: z.string().min(1).max(64) })

// ---------------------------------------------------------------------------
// Daftar tunggu (waiting list)
// ---------------------------------------------------------------------------

/** `roomType` null = any type. */
export const waitlistJoinInput = z.object({ kosId: z.string().min(1).max(64), roomType: z.string().trim().min(1).max(60).nullable() })
export const waitlistEntryInput = z.object({ entryId: z.string().min(1).max(64) })
export const ownerWaitlistRemoveInput = z.object({ kosId: z.string().min(1).max(64), entryId: z.string().min(1).max(64) })

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Name, WhatsApp number and campus. Email and password are not editable here (demo guard; email has its own verified flow). */
export const profilePhoneField = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{7,18}$/, 'Nomor telepon tidak valid')
  .nullable()
export const profileCampusField = z.string().trim().max(80).nullable()
export const profileUpdateInput = z.object({
  name: z.string().trim().min(1).max(80),
  phone: profilePhoneField,
  campus: profileCampusField,
})
export type ProfileUpdateInput = z.input<typeof profileUpdateInput>

/** Emergency contact. `consent` must be true: the student agrees that KoBo may message this person about an overdue payment. */
export const emergencyContactInput = z.object({
  name: z.string().trim().min(2).max(80),
  relation: z.string().trim().min(2).max(40),
  phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{7,18}$/, 'Nomor telepon tidak valid'),
  consent: z.literal(true, { message: 'Persetujuan diperlukan agar kontak darurat dapat dihubungi.' }),
})
export type EmergencyContactInput = z.input<typeof emergencyContactInput>

export const acceptTermsInput = z.object({ version: z.string().min(1).max(40) })
export const notifyPrefInput = z.object({ optOut: z.boolean() })

/** An owner opens a tenant's profile from an application or from a tenancy of their own kos. Exactly one of the two ids. */
export const tenantProfileInput = z
  .object({ kosId: z.string().min(1).max(64), applicationId: z.string().min(1).max(64).optional(), tenancyId: z.string().min(1).max(64).optional() })
  .refine((v) => (v.applicationId === undefined) !== (v.tenancyId === undefined), { message: 'Pilih satu pengajuan atau satu sewa.', path: ['applicationId'] })

// ---- Place catalogue (regions, nationwide campuses, places near a kos) ----

const latitude = z.number().min(-11).max(6)
const longitude = z.number().min(95).max(141)

/** Owner-added place text: free text, but never contact details or links (UU PDP); the server also checks with isPhoneLike / isUrlLike. */
const ownerPlaceText = (max: number) => z.string().trim().min(2).max(max)

export const placeReverseInput = z.object({ lat: latitude, lng: longitude })
export type PlaceReverseInput = z.input<typeof placeReverseInput>

export const regionChildrenInput = z.object({ parentCode: z.string().regex(/^\d{2}(\.\d{2}){0,2}(\.\d{4})?$/).optional() })
export const regionSearchInput = z.object({ q: z.string().trim().min(2).max(60), level: z.number().int().min(1).max(4).optional(), limit: z.number().int().min(1).max(20).default(10) })
export const regionLookupInput = z.object({ code: z.string().regex(/^\d{2}(\.\d{2}){0,2}(\.\d{4})?$/) })

export const campusBoxInput = z.object({
  minLat: z.number().min(-12).max(8), maxLat: z.number().min(-12).max(8), minLng: z.number().min(94).max(142), maxLng: z.number().min(94).max(142),
  limit: z.number().int().min(1).max(60).default(40),
})

export const campusSearchInput = z.object({
  q: z.string().trim().min(2).max(60),
  limit: z.number().int().min(1).max(20).default(10),
  /** 'location' returns physical campus pins; 'institution' collapses branches (e.g. BINUS University) for student verification. */
  scope: z.enum(['location', 'institution']).default('location'),
})

const PLACE_CATEGORY_ENUM = ['campus', 'food', 'minimarket', 'laundry', 'print', 'atm', 'pharmacy', 'clinic', 'hospital', 'police', 'worship', 'gym', 'cafe', 'transit', 'pasar'] as const
export const placeCategoryEnum = z.enum(PLACE_CATEGORY_ENUM)

export const ownerPlaceKosInput = z.object({ kosId: z.string().min(1).max(64) })
export const ownerPlaceRefInput = ownerPlaceKosInput.extend({ placeId: z.string().min(1).max(80) })
export const ownerPlaceAddInput = ownerPlaceKosInput.extend({
  name: ownerPlaceText(80),
  category: placeCategoryEnum,
  lat: latitude,
  lng: longitude,
  note: ownerPlaceText(140).optional(),
})
export type OwnerPlaceAddInput = z.input<typeof ownerPlaceAddInput>

export const OWNER_DOC_KINDS = ['KTP', 'SHM', 'SHGB', 'AJB', 'GIRIK', 'SPPT_PBB', 'SURAT_KUASA', 'SURAT_KETERANGAN'] as const
export type OwnerDocKind = (typeof OWNER_DOC_KINDS)[number]
export const OWNER_DOC_LABEL: Record<OwnerDocKind, string> = {
  KTP: 'KTP pemilik',
  SHM: 'Sertifikat Hak Milik (SHM)',
  SHGB: 'Sertifikat Hak Guna Bangunan (SHGB)',
  AJB: 'Akta Jual Beli (AJB)',
  GIRIK: 'Girik / Letter C',
  SPPT_PBB: 'SPPT PBB',
  SURAT_KUASA: 'Surat kuasa dari pemilik',
  SURAT_KETERANGAN: 'Surat keterangan dari RT/RW atau kelurahan',
}
/** Land-rights and authority documents; an owner submits a KTP plus at least one of these. */
export const OWNER_PROOF_KINDS = ['SHM', 'SHGB', 'AJB', 'GIRIK', 'SPPT_PBB', 'SURAT_KUASA', 'SURAT_KETERANGAN'] as const

export const ownerDocPresignInput = z.object({
  kind: z.enum(OWNER_DOC_KINDS),
  contentType: z.enum(OWNER_DOC_CONTENT_TYPES),
  contentLength: z.number().int().positive().max(10_000_000),
})
/** 1..4 documents: a first submit carries KTP + proof, a resubmit only the replacements; the server enforces the per-role set (Q6). */
export const ownerDocSubmitInput = z.object({
  documents: z.array(z.object({ kind: z.enum(OWNER_DOC_KINDS), key: z.string().min(1).max(300) })).min(1).max(4),
  consent: z.literal(true),
})
export type OwnerDocPresignInput = z.infer<typeof ownerDocPresignInput>
export type OwnerDocSubmitInput = z.infer<typeof ownerDocSubmitInput>

// ---------------------------------------------------------------------------
// Roommate matching (T1). Every input is by profileId / connectionId / requestId: the other user's userId is never exposed.
// ---------------------------------------------------------------------------

const NO_CONTACT = 'Jangan cantumkan nomor telepon, email, atau tautan. Gunakan obrolan KoBo setelah permintaan diterima.'
const noContact = (s: string) => !containsContactInfo(s)
const budgetStep = z.number().int().min(100_000).max(PRICE_MAX).refine((n) => n % 100_000 === 0, { message: 'Anggaran kelipatan Rp 100.000.' })
const rowId = z.string().min(1).max(64)

/**
 * Profile upsert. Required core (P1): displayName, gender, birthYear, budget range, anchor (+ radius, default 3), moveInDate, smoking.
 * Everything else is optional: intro empty, durationMonths 12, kosType (server default: the user's own gender), roomShare 2,
 * the other 8 lifestyle fields BEBAS. `active` is not an input: the server activates after the core is saved (setActive toggles).
 */
export const matchingProfileUpsertInput = z
  .object({
    displayName: z.string().trim().min(2, 'Nama tampilan minimal 2 karakter.').max(40),
    gender: z.enum(MATCH_GENDERS),
    birthYear: z.number().int().min(1950).max(2020),
    budgetMin: budgetStep,
    budgetMax: budgetStep,
    anchorLat: z.number().min(-11).max(6),
    anchorLng: z.number().min(95).max(141),
    anchorLabel: z.string().trim().min(1).max(80),
    radiusKm: z.number().int().min(1).max(15).default(3),
    moveInDate: calendarDay,
    smoking: z.enum(LIFESTYLE_VALUES.smoking),
    intro: z.string().trim().max(300).refine(noContact, { message: NO_CONTACT }).default(''),
    durationMonths: z.number().int().min(1).max(12).default(12),
    kosType: z.enum(MATCH_KOS_TYPES).optional(),
    roomShare: z.union([z.literal(2), z.literal(3)]).default(2),
    sleep: z.enum(LIFESTYLE_VALUES.sleep).default('BEBAS'),
    tidiness: z.enum(LIFESTYLE_VALUES.tidiness).default('BEBAS'),
    guests: z.enum(LIFESTYLE_VALUES.guests).default('BEBAS'),
    noise: z.enum(LIFESTYLE_VALUES.noise).default('BEBAS'),
    social: z.enum(LIFESTYLE_VALUES.social).default('BEBAS'),
    study: z.enum(LIFESTYLE_VALUES.study).default('BEBAS'),
    ac: z.enum(LIFESTYLE_VALUES.ac).default('BEBAS'),
    expenses: z.enum(LIFESTYLE_VALUES.expenses).default('BEBAS'),
  })
  .refine((v) => v.budgetMin <= v.budgetMax, { message: 'Anggaran minimum tidak boleh melebihi maksimum.', path: ['budgetMax'] })
export type MatchingProfileUpsertInput = z.input<typeof matchingProfileUpsertInput>

export const matchingSetActiveInput = z.object({ active: z.boolean() })
/** "Sudah dapat teman sekamar": pauses the profile and cancels pending requests; connections stay. */
export const matchingMarkFoundInput = z.object({}).optional()
export const matchingEmailOptOutInput = z.object({ emailOptOut: z.boolean() })

export const DISCOVER_SORTS = ['skor', 'jarak'] as const
export const discoverInput = z
  .object({
    maxDistanceKm: z.number().min(1).max(15).optional(),
    budgetMin: z.number().int().min(0).max(PRICE_MAX).optional(),
    budgetMax: z.number().int().min(0).max(PRICE_MAX).optional(),
    moveInBefore: calendarDay.optional(),
    sort: z.enum(DISCOVER_SORTS).default('skor'),
    /** Opaque; the server encodes (sort key, lastActiveAt, profileId). */
    cursor: z.string().max(200).optional(),
  })
  .default({ sort: 'skor' })
export type DiscoverInput = z.input<typeof discoverInput>

export const matchingDetailInput = z.object({ profileId: rowId })

/** The intro is refused when it carries contact info (chat only warns). */
export const requestSendInput = z.object({
  profileId: rowId,
  message: z.string().trim().max(300).refine(noContact, { message: NO_CONTACT }).optional(),
})
export const requestIdInput = z.object({ requestId: rowId })
export const requestListInput = z.object({ box: z.enum(['sent', 'received']), cursor: rowId.optional() })

export const connectionIdInput = z.object({ connectionId: rowId })
export const messageListInput = z.object({ connectionId: rowId, cursor: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).default(50) })
/** `confirmContact`: the sender saw the warning about contact info and still wants to send. */
export const messageSendInput = z.object({ connectionId: rowId, body: z.string().trim().min(1, 'Pesan tidak boleh kosong.').max(1000), confirmContact: z.boolean().optional() })

export const shortlistAddInput = z.object({ connectionId: rowId, kosId: rowId })
export const shortlistRemoveInput = shortlistAddInput

export const blockInput = z.object({ profileId: rowId })
export const unblockInput = z.object({ blockId: rowId })
export const REPORT_REASONS = ['PELECEHAN', 'SPAM_PENIPUAN', 'PROFIL_PALSU', 'KONTEN_TIDAK_PANTAS', 'LAINNYA'] as const
export const REPORT_REASON_LABEL: Record<(typeof REPORT_REASONS)[number], string> = {
  PELECEHAN: 'Pelecehan',
  SPAM_PENIPUAN: 'Spam atau penipuan',
  PROFIL_PALSU: 'Profil palsu (termasuk gender tidak sesuai)',
  KONTEN_TIDAK_PANTAS: 'Konten tidak pantas',
  LAINNYA: 'Alasan lain',
}
export const reportInput = z.object({
  profileId: rowId,
  reason: z.enum(REPORT_REASONS),
  detail: z.string().trim().max(500).default(''),
  connectionId: rowId.optional(),
  messageId: rowId.optional(),
})
export type ReportInput = z.input<typeof reportInput>
