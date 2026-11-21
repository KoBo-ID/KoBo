// Types only. No runtime code in this entry point.
export type RoomStatus = 'paid' | 'due' | 'overdue' | 'vacant' | 'booking'
export type CampusVerifyMethod = 'EMAIL' | 'MICROSOFT' | 'GOOGLE' | 'KTM' | 'SHEERID'
export interface StudentVerificationStatus {
  state: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED'
  via: CampusVerifyMethod | null
  until: string | null
  campus: string | null
  reason: string | null
  /** KTM rejections left before manual contact is needed (max 3). */
  attemptsLeft: number
  /** When the pending KTM was filed, ISO. */
  submittedAt: string | null
  /** Review time promise ("±20 menit" only while KTM auto-review is on; otherwise "1×24 jam"). */
  slaText: string
  /** sheerid: dev/test only (refused in production); see backend/src/sheerid.ts. */
  providers: { microsoft: boolean; google: boolean; sheerid?: boolean }
}
export type WaitlistStatus = 'WAITING' | 'OFFERED' | 'FULFILLED' | 'EXPIRED' | 'DECLINED' | 'LEFT' | 'REMOVED'

export type OwnerVerificationStatusName = 'BELUM_KIRIM' | 'MENUNGGU' | 'DISETUJUI' | 'DITOLAK'
export interface OwnerVerificationState {
  status: OwnerVerificationStatusName
  /** Declared role (null in the database counts as PEMILIK); decides which documents are required. */
  ownershipType: 'PEMILIK' | 'PENGELOLA_KUASA' | 'LAINNYA'
  reason: string | null
  attemptsLeft: number
  /** Review time promise shown to the owner, e.g. "Pemeriksaan maks. 2×24 jam kerja". */
  slaText: string
  documents: { kind: 'KTP' | 'SHM' | 'SHGB' | 'AJB' | 'GIRIK' | 'SPPT_PBB' | 'SURAT_KUASA' | 'SURAT_KETERANGAN'; status: 'PENDING' | 'APPROVED' | 'REJECTED'; createdAt: string }[]
}
/** Same shape as the backend's KtmPresign. */
export interface OwnerDocPresign {
  key: string
  url: string
  headers: Record<string, string>
  expiresInSeconds: number
}
/** `auth.me` adds `ownerStatus?: OwnerVerificationStatusName | null` in R3-A3 (null for non-owners). */

// ---------------------------------------------------------------------------
// Roommate matching (T1). None of these carry phone, email, address, the other user's userId, or a birth year:
// the other side is only ever a profileId, a display name and an age band.
// ---------------------------------------------------------------------------

export type MatchGenderName = 'LAKI_LAKI' | 'PEREMPUAN'
export type MatchKosTypeName = 'CAMPUR' | 'PUTRA' | 'PUTRI'
export type MatchAgeBand = '<18' | '18-20' | '21-23' | '24-26' | '27+'
export type MatchBandName = 'COCOK_BANGET' | 'CUKUP_COCOK' | 'MUNGKIN_COCOK'
export type MatchPartKeyName = 'budget' | 'location' | 'moveIn' | 'duration' | 'lifestyle' | 'room'

export interface MatchLifestyle {
  sleep: 'AWAL' | 'NORMAL' | 'MALAM' | 'BEBAS'
  tidiness: 'SANTAI' | 'CUKUP' | 'RAPI' | 'BEBAS'
  smoking: 'MEROKOK' | 'TIDAK_MEROKOK_TOLERAN' | 'TIDAK_MAU_PEROKOK' | 'BEBAS'
  guests: 'JARANG' | 'KADANG' | 'SERING' | 'BEBAS'
  noise: 'TENANG' | 'SEDANG' | 'RAMAI' | 'BEBAS'
  social: 'INTROVERT' | 'SEIMBANG' | 'EKSTROVERT' | 'BEBAS'
  study: 'DI_KAMAR' | 'CAMPUR' | 'DI_LUAR' | 'BEBAS'
  ac: 'SELALU' | 'MALAM_SAJA' | 'TANPA_AC' | 'BEBAS'
  expenses: 'PATUNGAN' | 'SEBAGIAN' | 'TERPISAH' | 'BEBAS'
}

export interface MatchScorePart {
  key: MatchPartKeyName
  points: number
  max: number
  reason: string
}
export interface MatchScoreView {
  /** 0..100, computed by the server from both stored profiles. */
  score: number
  band: MatchBandName
  /** True when the lifestyle answers are thin: show "Perkiraan" next to the score. */
  approximate: boolean
  parts: MatchScorePart[]
}

/** The user's own profile (own birth year is fine: it is their data). Null from `profile.get` before one exists. */
export interface MyMatchingProfile extends MatchLifestyle {
  id: string
  displayName: string
  /** S1: false while the profile is younger than 24 h (it can still receive requests). */
  canSendRequests: boolean
  intro: string
  gender: MatchGenderName
  birthYear: number
  campusId: string | null
  active: boolean
  /** ISO; set while "Sudah dapat teman sekamar" is on. */
  pausedAt: string | null
  /** ISO; set while 3+ reports hide the profile. The owner sees a notice, not the reporters. */
  hiddenByReportsAt: string | null
  emailOptOut: boolean
  budgetMin: number
  budgetMax: number
  anchorLat: number
  anchorLng: number
  anchorLabel: string
  radiusKm: number
  /** 'YYYY-MM-DD'. */
  moveInDate: string
  durationMonths: number
  kosType: MatchKosTypeName
  roomShare: number
  /** 0..100: share of the optional fields the user changed from the default (completeness meter). */
  completeness: number
}

/** A candidate as seen in discover and detail. `profileId` is the only identifier of the other side. */
export interface MatchCandidate extends MatchLifestyle {
  profileId: string
  displayName: string
  ageBand: MatchAgeBand
  gender: MatchGenderName
  /** Campus name for display (resolved server-side from campusId). */
  campusLabel: string | null
  intro: string
  budgetMin: number
  budgetMax: number
  anchorLabel: string
  radiusKm: number
  /** Rounded to 0.5 km. */
  distanceKm: number
  moveInDate: string
  durationMonths: number
  kosType: MatchKosTypeName
  roomShare: number
  /** ISO day of the last activity, for "Aktif 3 hari lalu". */
  lastActiveAt: string
  match: MatchScoreView
  /** Where the pair stands, so the card can show "Permintaan terkirim" instead of the send button. */
  relation: 'NONE' | 'REQUEST_SENT' | 'REQUEST_RECEIVED' | 'CONNECTED'
  /** The request id when relation is REQUEST_SENT or REQUEST_RECEIVED (accept/decline/cancel input). */
  requestId: string | null
  /** The connection id when relation is CONNECTED. */
  connectionId: string | null
}

export type DiscoverEmptyReason = 'NO_PROFILE' | 'INACTIVE' | 'COLD_START' | 'TOO_NARROW'
export interface DiscoverResult {
  items: MatchCandidate[]
  nextCursor: string | null
  /** Why the list is empty (null when it is not): four different screens (E1). */
  emptyReason: DiscoverEmptyReason | null
  /** Only with TOO_NARROW: "Perluas radius ke 5 km: +N orang". Counts only, no identities. */
  widenHint?: { radiusKm: number; extra: number }
}

export type PartnerRequestStatusName = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED'
export interface PartnerRef {
  /** Null once the profile was deleted. */
  profileId: string | null
  /** "Pengguna KoBo" once the profile was deleted. */
  displayName: string
  deleted: boolean
  ageBand: MatchAgeBand | null
}
export interface PartnerRequestView {
  id: string
  direction: 'sent' | 'received'
  partner: PartnerRef
  message: string
  /** The sender sees DECLINED as "Tidak dilanjutkan" (no reason). */
  status: PartnerRequestStatusName
  createdAt: string
  expiresAt: string
  /** Null when the pair no longer passes the filters (a request stays readable). */
  match: MatchScoreView | null
  /** The recipient is at the live-connection cap: "Akhiri satu koneksi dulu". */
  blockedByCap: boolean
}
export interface PartnerRequestList {
  items: PartnerRequestView[]
  /** Pass back as `cursor` for the next 20; null on the last page. */
  nextCursor: string | null
  /** "sisa 7 permintaan": outgoing PENDING slots and today's send budget left for the caller. */
  pendingSlotsLeft: number
  sentTodayLeft: number
}

export type PartnerEndReasonName = 'ENDED_BY_USER' | 'BLOCKED' | 'PROFILE_DELETED' | 'SELESAI'
export interface PartnerConnectionView {
  id: string
  partner: PartnerRef
  createdAt: string
  endedAt: string | null
  endReason: PartnerEndReasonName | null
  /** Unread messages from the partner. */
  unread: number
  lastMessage: { body: string; mine: boolean; createdAt: string } | null
  /** The score at read time, for the starter chips; null when the profile is gone. */
  match: MatchScoreView | null
}

export interface PartnerMessageView {
  id: string
  mine: boolean
  body: string
  createdAt: string
}
export interface PartnerMessagePage {
  /** Oldest first within the page. */
  items: PartnerMessageView[]
  /** Pass back as `cursor` to load older messages; null at the start. */
  nextCursor: string | null
  /** False when the connection ended or the partner is blocked: the UI shows it read-only. */
  canSend: boolean
}
/** `message.send` answer. `needsConfirm` means nothing was saved: contact info was found and `confirmContact` was not set. */
export type PartnerMessageSendResult = { sent: true; message: PartnerMessageView } | { sent: false; needsConfirm: true }

export interface SharedShortlistEntry {
  kosId: string
  /** "Kamu" or the partner's display name. */
  addedBy: string
  slug: string
  name: string
  city: string
  district: string
  /** Lowest price per room of the kos. */
  priceFrom: number
  addedByMe: boolean
  createdAt: string
}
export interface KosCandidate {
  kosId: string
  slug: string
  name: string
  city: string
  district: string
  /** SHAREABLE: a room with maxOccupants >= 2 fits the combined budget. ASK_OWNER: capacity unknown, inside the budget (E4). */
  status: 'SHAREABLE' | 'ASK_OWNER'
  /** Price shown and what it means: "per kamar" or "per orang". */
  price: number
  priceUnit: 'PER_KAMAR' | 'PER_ORANG'
  roomsFitting: number
  inShortlist: boolean
}

export interface MatchBlockView {
  id: string
  /** Null when the blocked profile was deleted. */
  profileId: string | null
  displayName: string
  createdAt: string
}

/** `matching.unreadCount` and the nav badge: messages plus requests waiting for an answer. */
export interface MatchingUnread {
  messages: number
  requests: number
  /** Unread messages per connection id. */
  perConnection: Record<string, number>
}
