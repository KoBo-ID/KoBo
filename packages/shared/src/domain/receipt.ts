import { todayWIB } from './wib.ts'

/** 'KB/YYYY/MM/NNNN' using the WIB year and month of paidAt. Numbers wider than 4 digits are not truncated. */
export function formatReceiptNo(receiptNo: number, paidAt: Date): string {
  const [year, month] = todayWIB(paidAt).split('-')
  return `KB/${year}/${month}/${String(receiptNo).padStart(4, '0')}`
}
