// Zod schemas. Server and lazy routes only (never import from the landing chunk).
import { z } from 'zod'
import { MAX_LEASE_MONTHS } from './domain/pricing.ts'
import { GENDER_FILTERS, PRICE_MAX, SEARCH_RADIUS_MAX, SEARCH_RADIUS_MIN, SORT_KEYS } from './search.ts'

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
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMonths: z.number().int().min(1).max(MAX_LEASE_MONTHS),
})
export type BookingCreateInput = z.input<typeof bookingCreateInput>

export const rentalApplicationCreateInput = bookingCreateInput.extend({
  occupation: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional(),
})

export const rentalApplicationDecisionInput = z.object({
  kosId: z.string().min(1).max(64),
  applicationId: z.string().min(1).max(64),
  decision: z.enum(['APPROVE', 'REJECT']),
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

/** Abuse cap: rooms per kos, enforced at creation and on room.create. */
export const MAX_ROOMS_PER_KOS = 40
/** Abuse cap: kos per owner. */
export const MAX_KOS_PER_OWNER = 5

const text = (max: number) => z.string().trim().min(1).max(max)
const rupiah = z.number().int().min(0).max(50_000_000)

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

export const tenancyEndInput = z.object({ kosId: z.string().min(1).max(64), tenancyId: z.string().min(1).max(64) })

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
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
export const profileUpdateInput = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 ()-]{7,18}$/, 'Nomor telepon tidak valid')
    .nullable(),
  campus: z.string().trim().max(80).nullable(),
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

export const campusSearchInput = z.object({ q: z.string().trim().min(2).max(60), limit: z.number().int().min(1).max(20).default(10) })

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
