// Roommate matching: the pure score, the hard filters and the text helpers (T1, Q1 in .orchestration/decisions.md).
// Pure on purpose: the server computes every score from two stored profiles, the client never sends one.
import { parseCalendarDay } from './calendarDay.ts'
import { haversineMeters } from './geo.ts'

export const MATCH_GENDERS = ['LAKI_LAKI', 'PEREMPUAN'] as const
export type MatchGender = (typeof MATCH_GENDERS)[number]

export const MATCH_KOS_TYPES = ['CAMPUR', 'PUTRA', 'PUTRI'] as const
export type MatchKosType = (typeof MATCH_KOS_TYPES)[number]

/**
 * The 9 lifestyle fields. Each value list is ordered: neighbours are "adjacent" (0.5), the ends are "opposite" (0), and
 * `BEBAS` (no preference, always last) scores 0.75 against anything. Every list mirrors a Prisma enum of the same values.
 */
export const LIFESTYLE_VALUES = {
  sleep: ['AWAL', 'NORMAL', 'MALAM', 'BEBAS'],
  tidiness: ['SANTAI', 'CUKUP', 'RAPI', 'BEBAS'],
  smoking: ['MEROKOK', 'TIDAK_MEROKOK_TOLERAN', 'TIDAK_MAU_PEROKOK', 'BEBAS'],
  guests: ['JARANG', 'KADANG', 'SERING', 'BEBAS'],
  noise: ['TENANG', 'SEDANG', 'RAMAI', 'BEBAS'],
  social: ['INTROVERT', 'SEIMBANG', 'EKSTROVERT', 'BEBAS'],
  study: ['DI_KAMAR', 'CAMPUR', 'DI_LUAR', 'BEBAS'],
  ac: ['SELALU', 'MALAM_SAJA', 'TANPA_AC', 'BEBAS'],
  expenses: ['PATUNGAN', 'SEBAGIAN', 'TERPISAH', 'BEBAS'],
} as const
export type LifestyleKey = keyof typeof LIFESTYLE_VALUES
export const LIFESTYLE_KEYS = Object.keys(LIFESTYLE_VALUES) as LifestyleKey[]
export type LifestyleValue<K extends LifestyleKey> = (typeof LIFESTYLE_VALUES)[K][number]
export type LifestyleAnswers = { [K in LifestyleKey]: LifestyleValue<K> }

/** Indonesian labels for the form and the detail page. */
export const LIFESTYLE_LABEL: Record<LifestyleKey, string> = {
  sleep: 'Jam tidur',
  tidiness: 'Kerapian',
  smoking: 'Merokok',
  guests: 'Tamu',
  noise: 'Kebisingan',
  social: 'Sifat sosial',
  study: 'Tempat belajar',
  ac: 'Pemakaian AC',
  expenses: 'Pengeluaran bersama',
}
export const LIFESTYLE_VALUE_LABEL: { [K in LifestyleKey]: Record<LifestyleValue<K>, string> } = {
  sleep: { AWAL: 'Tidur awal', NORMAL: 'Tidur normal', MALAM: 'Begadang', BEBAS: 'Bebas' },
  tidiness: { SANTAI: 'Santai', CUKUP: 'Cukup rapi', RAPI: 'Sangat rapi', BEBAS: 'Bebas' },
  smoking: { MEROKOK: 'Merokok', TIDAK_MEROKOK_TOLERAN: 'Tidak merokok, toleran', TIDAK_MAU_PEROKOK: 'Tidak mau teman perokok', BEBAS: 'Bebas' },
  guests: { JARANG: 'Jarang ada tamu', KADANG: 'Kadang-kadang', SERING: 'Sering ada tamu', BEBAS: 'Bebas' },
  noise: { TENANG: 'Tenang', SEDANG: 'Sedang', RAMAI: 'Ramai', BEBAS: 'Bebas' },
  social: { INTROVERT: 'Lebih suka sendiri', SEIMBANG: 'Seimbang', EKSTROVERT: 'Suka bersosialisasi', BEBAS: 'Bebas' },
  study: { DI_KAMAR: 'Belajar di kamar', CAMPUR: 'Campur', DI_LUAR: 'Belajar di luar', BEBAS: 'Bebas' },
  ac: { SELALU: 'AC selalu menyala', MALAM_SAJA: 'AC malam saja', TANPA_AC: 'Tanpa AC', BEBAS: 'Bebas' },
  expenses: { PATUNGAN: 'Patungan', SEBAGIAN: 'Sebagian dibagi', TERPISAH: 'Terpisah', BEBAS: 'Bebas' },
}

/** Fields a new profile starts with: smoking has to be chosen on purpose, the other 8 default to BEBAS. */
export const LIFESTYLE_DEFAULTS: Omit<LifestyleAnswers, 'smoking'> = {
  sleep: 'BEBAS',
  tidiness: 'BEBAS',
  guests: 'BEBAS',
  noise: 'BEBAS',
  social: 'BEBAS',
  study: 'BEBAS',
  ac: 'BEBAS',
  expenses: 'BEBAS',
}

export interface MatchInput extends LifestyleAnswers {
  gender: MatchGender
  /** Rupiah per month. */
  budgetMin: number
  budgetMax: number
  anchorLat: number
  anchorLng: number
  radiusKm: number
  /** 'YYYY-MM-DD'. */
  moveInDate: string
  durationMonths: number
  kosType: MatchKosType
  /** 2 or 3 people share the room. */
  roomShare: number
}

export type MatchPartKey = 'budget' | 'location' | 'moveIn' | 'duration' | 'lifestyle' | 'room'
export interface MatchPart {
  key: MatchPartKey
  /** Integer points; the six parts sum to `score` (largest-remainder rounding). */
  points: number
  max: number
  /** One Indonesian sentence. */
  reason: string
}
export interface MatchResult {
  score: number
  parts: MatchPart[]
  /** True when 6 or more of the 9 lifestyle fields are BEBAS on either side: show "Perkiraan" next to the score. */
  approximate: boolean
}

export const MATCH_WEIGHTS: Record<MatchPartKey, number> = { budget: 30, location: 25, moveIn: 15, duration: 10, lifestyle: 15, room: 5 }
const PART_ORDER: MatchPartKey[] = ['budget', 'location', 'moveIn', 'duration', 'lifestyle', 'room']

export const BUDGET_STEP = 100_000
const MOVE_IN_WINDOW_DAYS = 60
export const BEBAS_SCORE = 0.75
export const APPROXIMATE_BEBAS_FIELDS = 6

export type HardFilterReason = 'GENDER' | 'BUDGET' | 'JARAK' | 'MEROKOK'

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** Distance between the two anchors, km (unrounded; callers round to 0.5 km for display). */
export function anchorDistanceKm(a: Pick<MatchInput, 'anchorLat' | 'anchorLng'>, b: Pick<MatchInput, 'anchorLat' | 'anchorLng'>): number {
  return haversineMeters({ lat: a.anchorLat, lng: a.anchorLng }, { lat: b.anchorLat, lng: b.anchorLng }) / 1000
}

/** Pairs that never get scored or listed. Order: gender, budget, distance, smoking. Symmetric. */
export function hardFilter(a: MatchInput, b: MatchInput): HardFilterReason | null {
  if (a.gender !== b.gender) return 'GENDER'
  if (Math.max(a.budgetMin, b.budgetMin) > Math.min(a.budgetMax, b.budgetMax)) return 'BUDGET'
  if (anchorDistanceKm(a, b) > Math.min(a.radiusKm, b.radiusKm)) return 'JARAK'
  if ((a.smoking === 'MEROKOK' && b.smoking === 'TIDAK_MAU_PEROKOK') || (b.smoking === 'MEROKOK' && a.smoking === 'TIDAK_MAU_PEROKOK')) return 'MEROKOK'
  return null
}

/** F1: inclusive overlap with a Rp 100k floor on both sides, so identical points score 1 and touching ranges can pass. */
export function budgetFraction(a: Pick<MatchInput, 'budgetMin' | 'budgetMax'>, b: Pick<MatchInput, 'budgetMin' | 'budgetMax'>): number {
  const overlap = Math.max(0, Math.min(a.budgetMax, b.budgetMax) - Math.max(a.budgetMin, b.budgetMin))
  const union = Math.max(a.budgetMax, b.budgetMax) - Math.min(a.budgetMin, b.budgetMin)
  return clamp01(Math.max(overlap, BUDGET_STEP) / Math.max(union, BUDGET_STEP))
}

/** 1 equal, 0.5 neighbours, 0 further apart, 0.75 when either side is BEBAS. */
export function lifestyleFieldScore<K extends LifestyleKey>(key: K, x: LifestyleValue<K>, y: LifestyleValue<K>): number {
  if (x === 'BEBAS' || y === 'BEBAS') return BEBAS_SCORE
  const levels: readonly string[] = LIFESTYLE_VALUES[key]
  const gap = Math.abs(levels.indexOf(x) - levels.indexOf(y))
  return gap === 0 ? 1 : gap === 1 ? 0.5 : 0
}

const dayNumber = (s: string): number => {
  const p = parseCalendarDay(s)
  return p ? Date.UTC(p.y, p.m - 1, p.d) / 86_400_000 : Number.NaN
}

const km1 = (km: number) => `${(Math.round(km * 10) / 10).toString().replace('.', ',')} km`
const rupiahShort = (n: number) => `Rp ${(n / 1_000_000).toString().replace('.', ',')} jt`

function bebasCount(p: LifestyleAnswers): number {
  return LIFESTYLE_KEYS.filter((k) => p[k] === 'BEBAS').length
}

/** Whether a profile's lifestyle answers are too thin to rank on (F2). */
export const isLifestyleThin = (p: LifestyleAnswers): boolean => bebasCount(p) >= APPROXIMATE_BEBAS_FIELDS

/**
 * Symmetric 0..100 score with a per-criterion breakdown. Weights 30/25/15/10/15/5. Hard-filtered pairs still get a (clamped)
 * score; callers drop them with `hardFilter` first.
 */
export function matchScore(a: MatchInput, b: MatchInput): MatchResult {
  const budget = budgetFraction(a, b)
  const km = anchorDistanceKm(a, b)
  const radius = Math.min(a.radiusKm, b.radiusKm)
  const location = clamp01(1 - km / radius)
  const days = Math.abs(dayNumber(a.moveInDate) - dayNumber(b.moveInDate))
  const moveIn = Number.isFinite(days) ? clamp01(1 - days / MOVE_IN_WINDOW_DAYS) : 0
  const duration = Math.min(a.durationMonths, b.durationMonths) / Math.max(a.durationMonths, b.durationMonths)
  const lifestyleSum = LIFESTYLE_KEYS.reduce((sum, k) => sum + lifestyleFieldScore(k, a[k] as never, b[k] as never), 0)
  const lifestyle = lifestyleSum / LIFESTYLE_KEYS.length
  const sameShare = a.roomShare === b.roomShare
  const kosOk = a.kosType === b.kosType || a.kosType === 'CAMPUR' || b.kosType === 'CAMPUR'
  const room = 0.5 * (sameShare ? 1 : 0) + 0.5 * (kosOk ? 1 : 0)

  const fractions: Record<MatchPartKey, number> = { budget, location, moveIn, duration, lifestyle, room }
  const approximate = isLifestyleThin(a) || isLifestyleThin(b)

  const reasons: Record<MatchPartKey, string> = {
    budget:
      budget >= 0.999
        ? 'Anggaran sama persis.'
        : budget >= 0.6
          ? 'Anggaran hampir sama.'
          : `Anggaran saling beririsan sebagian (${rupiahShort(Math.max(a.budgetMin, b.budgetMin))}–${rupiahShort(Math.min(a.budgetMax, b.budgetMax))}).`,
    location: km < 0.05 ? 'Titik acuan sama.' : `Titik acuan berjarak sekitar ${km1(km)}.`,
    moveIn: days < 1 ? 'Rencana pindah di hari yang sama.' : `Rencana pindah berbeda ${Math.round(days)} hari.`,
    duration: a.durationMonths === b.durationMonths ? `Sama-sama ${a.durationMonths} bulan.` : `Lama sewa ${Math.min(a.durationMonths, b.durationMonths)} dan ${Math.max(a.durationMonths, b.durationMonths)} bulan.`,
    lifestyle: approximate ? 'Gaya hidup belum banyak diisi.' : `Kecocokan gaya hidup ${Math.round(lifestyle * 100)}%.`,
    room: sameShare && kosOk ? 'Jumlah penghuni kamar dan jenis kos cocok.' : sameShare ? 'Jenis kos berbeda.' : kosOk ? 'Jumlah penghuni kamar berbeda.' : 'Jumlah penghuni dan jenis kos berbeda.',
  }

  // Largest-remainder rounding: the six integers add up to the shown total (F5).
  const raw = PART_ORDER.map((key) => MATCH_WEIGHTS[key] * fractions[key])
  const score = Math.max(0, Math.min(100, Math.round(raw.reduce((s, v) => s + v, 0) + 1e-9)))
  const points = raw.map((v) => Math.floor(v + 1e-9))
  let left = score - points.reduce((s, v) => s + v, 0)
  const byRemainder = raw
    .map((v, i) => ({ i, rem: v - points[i]! }))
    .sort((x, y) => y.rem - x.rem || x.i - y.i)
  for (const { i, rem } of byRemainder) {
    if (left <= 0 || rem < 1e-9) break
    points[i]! += 1
    left -= 1
  }

  return {
    score,
    approximate,
    parts: PART_ORDER.map((key, i) => ({ key, points: points[i]!, max: MATCH_WEIGHTS[key], reason: reasons[key] })),
  }
}

export type MatchBand = 'COCOK_BANGET' | 'CUKUP_COCOK' | 'MUNGKIN_COCOK'
/** F4: bands next to the percentage. */
export const matchBand = (score: number): MatchBand => (score >= 75 ? 'COCOK_BANGET' : score >= 50 ? 'CUKUP_COCOK' : 'MUNGKIN_COCOK')
export const MATCH_BAND_LABEL: Record<MatchBand, string> = { COCOK_BANGET: 'Cocok banget', CUKUP_COCOK: 'Cukup cocok', MUNGKIN_COCOK: 'Mungkin cocok' }

// ---------------------------------------------------------------------------
// Age band (birth year is stored, never shown)
// ---------------------------------------------------------------------------

export const MIN_MATCH_AGE = 18
export type AgeBand = '<18' | '18-20' | '21-23' | '24-26' | '27+'

/** Approximate age from the birth year alone (calendar-year difference, UTC). */
export const ageOf = (birthYear: number, now: Date): number => now.getUTCFullYear() - birthYear

export function ageBand(birthYear: number, now: Date): AgeBand {
  const age = ageOf(birthYear, now)
  if (age < MIN_MATCH_AGE) return '<18'
  if (age <= 20) return '18-20'
  if (age <= 23) return '21-23'
  if (age <= 26) return '24-26'
  return '27+'
}

// ---------------------------------------------------------------------------
// Contact-info detector (the request intro refuses it; chat only warns)
// ---------------------------------------------------------------------------

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i
const URL_LIKE = /(https?:\/\/|www\.|\bwa\.me\b|\bt\.me\b|\bwhatsapp\.com\b|\b[a-z0-9-]+\.(?:com|co\.id|id|net|org|me|io|link|ly|gl)\b)/i
const HANDLE = /(?:^|[\s(])@[a-z0-9_.]{2,}/i
const DIGIT_RUN = /\+?\d[\d\s-]{6,}\d/g
const DOTTED_PHONE = /(?:\+62|(?<!\d)0)8[\d.\s-]{7,}\d/g
const digitsIn = (s: string) => s.replace(/\D/g, '').length

/**
 * True when the text carries a phone number (08…, +62…, any run of 9 or more digits with spaces or dashes), an email, a URL,
 * wa.me or an @handle. A spaced dash splits a run so "1500000 - 2000000" (a budget range) is not a phone number. Spelled-out
 * digits ("nol delapan") are not caught; the report button covers those.
 */
export function containsContactInfo(text: string): boolean {
  if (EMAIL.test(text) || URL_LIKE.test(text) || HANDLE.test(text)) return true
  for (const run of text.match(DIGIT_RUN) ?? []) {
    for (const piece of run.split(/\s+-\s+/)) if (digitsIn(piece) >= 9) return true
  }
  for (const run of text.match(DOTTED_PHONE) ?? []) if (digitsIn(run) >= 9) return true
  return false
}
