/** Real calendar validation for 'YYYY-MM-DD' strings (rejects 2026-11-31 and 2026-02-29). */
export function parseCalendarDay(s: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1) return null
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > daysInMonth) return null
  return { y, m, d }
}

export function isCalendarDay(s: string): boolean {
  return parseCalendarDay(s) !== null
}
