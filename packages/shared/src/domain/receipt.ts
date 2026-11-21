import { terbilang } from './terbilang.ts'
import { todayWIB } from './wib.ts'

/** 'KB/YYYY/MM/NNNN' using the WIB year and month of paidAt. Numbers wider than 4 digits are not truncated. */
export function formatReceiptNo(receiptNo: number, paidAt: Date): string {
  const [year, month] = todayWIB(paidAt).split('-')
  return `KB/${year}/${month}/${String(receiptNo).padStart(4, '0')}`
}

/** terbilang for the "Uang sejumlah" line, or null when the amount is out of range (the receipt then omits the line). */
export function receiptTerbilang(amount: number): string | null {
  try {
    return terbilang(amount)
  } catch {
    return null
  }
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

/** 'YYYY-MM-DD' as '5 Januari 2027' (calendar day, no timezone involved). */
export function formatDayId(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}

/** '5 Januari 2027 – 4 Februari 2027' for the "Untuk pembayaran" line. */
export function formatReceiptPeriod(periodStart: string, periodEnd: string): string {
  return `${formatDayId(periodStart)} – ${formatDayId(periodEnd)}`
}
