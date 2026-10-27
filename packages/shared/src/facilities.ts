// Structured facilities (Kamar and Gedung scopes). Pure: used by the server (validation, derived arrays) and the client (form, detail page).

export type FacilityScope = 'KAMAR' | 'GEDUNG'
export type FacilityGroup = 'KAMAR' | 'KEAMANAN' | 'PARKIR' | 'UTILITAS' | 'LAYANAN' | 'DAPUR' | 'LAINNYA'
/** Facilities that are not offered are simply not listed. */
export type FacilityStatus = 'INCLUDED' | 'PAID'

export interface FacilityItem {
  label: string
  scope: FacilityScope
  group: FacilityGroup
  status: FacilityStatus
  /** Rupiah per month (or per use, described in `note`) when `status` is PAID. */
  fee?: number | null
  /** Short detail: "100 Mbps", "15 motor", "12 kg per bulan". */
  note?: string
}

export const FACILITY_SCOPES: { id: FacilityScope; label: string }[] = [
  { id: 'KAMAR', label: 'Kamar' },
  { id: 'GEDUNG', label: 'Gedung' },
]

export const FACILITY_GROUPS: { id: FacilityGroup; label: string; scope: FacilityScope }[] = [
  { id: 'KAMAR', label: 'Isi kamar', scope: 'KAMAR' },
  { id: 'KEAMANAN', label: 'Keamanan', scope: 'GEDUNG' },
  { id: 'PARKIR', label: 'Parkir', scope: 'GEDUNG' },
  { id: 'UTILITAS', label: 'Utilitas', scope: 'GEDUNG' },
  { id: 'LAYANAN', label: 'Layanan', scope: 'GEDUNG' },
  { id: 'DAPUR', label: 'Dapur dan area bersama', scope: 'GEDUNG' },
  { id: 'LAINNYA', label: 'Lainnya', scope: 'GEDUNG' },
]

/** Suggestions the owner form offers (one tap to add); owners can still type their own. */
export const FACILITY_PRESETS: { label: string; group: FacilityGroup }[] = [
  { label: 'AC', group: 'KAMAR' },
  { label: 'Kamar mandi dalam', group: 'KAMAR' },
  { label: 'Water heater', group: 'KAMAR' },
  { label: 'Kasur', group: 'KAMAR' },
  { label: 'Lemari pakaian', group: 'KAMAR' },
  { label: 'Meja dan kursi belajar', group: 'KAMAR' },
  { label: 'CCTV', group: 'KEAMANAN' },
  { label: 'Penjaga kos', group: 'KEAMANAN' },
  { label: 'Akses kartu', group: 'KEAMANAN' },
  { label: 'Parkir motor', group: 'PARKIR' },
  { label: 'Parkir mobil', group: 'PARKIR' },
  { label: 'Wi-Fi', group: 'UTILITAS' },
  { label: 'Listrik', group: 'UTILITAS' },
  { label: 'Air', group: 'UTILITAS' },
  { label: 'Laundry', group: 'LAYANAN' },
  { label: 'Kebersihan kamar', group: 'LAYANAN' },
  { label: 'Dapur bersama', group: 'DAPUR' },
  { label: 'Kulkas bersama', group: 'DAPUR' },
  { label: 'Dispenser air minum', group: 'DAPUR' },
  { label: 'Mesin cuci', group: 'DAPUR' },
  { label: 'Jemuran', group: 'DAPUR' },
  { label: 'Ruang tamu', group: 'DAPUR' },
]

export const groupLabel = (group: FacilityGroup) => FACILITY_GROUPS.find((g) => g.id === group)?.label ?? 'Lainnya'
export const scopeOfGroup = (group: FacilityGroup): FacilityScope => (group === 'KAMAR' ? 'KAMAR' : 'GEDUNG')

/** The flat arrays that search filters and older code read: every listed item, by scope. */
export function amenityArrays(items: readonly FacilityItem[]): { privateAmenities: string[]; sharedAmenities: string[] } {
  return {
    privateAmenities: items.filter((i) => i.scope === 'KAMAR').map((i) => i.label),
    sharedAmenities: items.filter((i) => i.scope === 'GEDUNG').map((i) => i.label),
  }
}

const GROUP_HINTS: [RegExp, FacilityGroup][] = [
  [/cctv|security|satpam|penjaga|kartu|akses/i, 'KEAMANAN'],
  [/parkir/i, 'PARKIR'],
  [/wi-?fi|internet|listrik|token|air\b/i, 'UTILITAS'],
  [/laundry|kebersihan|cleaning|setrika/i, 'LAYANAN'],
  [/dapur|kulkas|dispenser|galon|cuci|jemur|tamu|rooftop|mushola/i, 'DAPUR'],
]

/** Rows saved before structured facilities existed: every string becomes an included item, grouped by keyword. */
export function itemsFromArrays(privateAmenities: readonly string[], sharedAmenities: readonly string[]): FacilityItem[] {
  return [
    ...privateAmenities.map((label): FacilityItem => ({ label, scope: 'KAMAR', group: 'KAMAR', status: 'INCLUDED' })),
    ...sharedAmenities.map((label): FacilityItem => ({
      label,
      scope: 'GEDUNG',
      group: GROUP_HINTS.find(([re]) => re.test(label))?.[1] ?? 'LAINNYA',
      status: 'INCLUDED',
    })),
  ]
}

/** What the client shows as the status text: "Termasuk", "Berbayar" or the fee. */
export function statusLabel(item: Pick<FacilityItem, 'status' | 'fee'>, formatMoney: (n: number) => string): string {
  if (item.status === 'INCLUDED') return 'Termasuk'
  return item.fee ? formatMoney(item.fee) : 'Berbayar'
}
