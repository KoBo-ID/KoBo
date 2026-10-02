// Zod schemas. Server and lazy routes only (never import from the landing chunk).
import { z } from 'zod'
import { MAX_LEASE_MONTHS } from './domain/pricing.ts'
import { GENDER_FILTERS, PRICE_MAX, SORT_KEYS } from './search.ts'

export const kosListInput = z.object({ limit: z.number().int().min(1).max(200).optional() }).optional()
export type KosListInput = z.infer<typeof kosListInput>

/** Mirrors the Search page filters. With lat/lng, only kos within 5 km of that point are returned. */
export const kosSearchInput = z
  .object({
    q: z.string().trim().max(100).default(''),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    /** Display label of the reference point. Not used for filtering. */
    locationLabel: z.string().max(80).optional(),
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

export const paymentIdInput = z.object({ paymentId: z.string().min(1).max(64) })

/** `kosId` is required by ownerProcedure (the authorization root); the invoice must belong to that kos. */
export const recordManualInput = z.object({ kosId: z.string().min(1).max(64), invoiceId: z.string().min(1).max(64) })

/** Body of POST /api/webhooks/payment. */
export const paymentEventSchema = z.object({ externalId: z.string().min(1).max(128), status: z.literal('PAID') })
export type PaymentEvent = z.infer<typeof paymentEventSchema>

// ---------------------------------------------------------------------------
// Owner workspace (spec sections 3 and 5). Every owner write carries `kosId`, the authorization root.
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max)
const rupiah = z.number().int().min(0).max(50_000_000)

export const kosIdOnly = z.object({ kosId: z.string().min(1).max(64) })

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
  privateAmenities: z.array(text(60)).max(30),
  sharedAmenities: z.array(text(60)).max(30),
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
  /** Optional starter rooms: numbered 101, 102, ... (4 per floor), all vacant. */
  initialRooms: z.object({ count: z.number().int().min(1).max(50), priceMonthly: rupiah }).optional(),
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
