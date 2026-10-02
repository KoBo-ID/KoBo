const WIB_ZONE = 'Asia/Jakarta'

const wibFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: WIB_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Calendar date in WIB (UTC+7, no DST) as 'YYYY-MM-DD'. `now` is always injected. */
export function todayWIB(now: Date): string {
  const parts = wibFormatter.formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Negative if a < b, 0 if equal, positive if a > b. Works because the format is zero-padded. */
export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const parse = (s: string): [number, number, number] => {
  const [y, m, d] = s.split('-').map(Number)
  return [y, m, d]
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export function addDays(date: string, days: number): string {
  const [y, m, d] = parse(date)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Adds calendar months, clamping the day to the target month's length (Jan 31 + 1 = Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parse(date)
  const idx = y * 12 + (m - 1) + months
  const ny = Math.floor(idx / 12)
  const nm = idx - ny * 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${pad(ny, 4)}-${pad(nm + 1)}-${pad(Math.min(d, last))}`
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'); positive when `to` is later. */
export function diffDays(from: string, to: string): number {
  const [y1, m1, d1] = parse(from)
  const [y2, m2, d2] = parse(to)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}
