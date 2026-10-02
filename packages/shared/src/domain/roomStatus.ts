import type { RoomStatus } from '../types'
import { addDays, compareDates, diffDays, todayWIB } from './wib.ts'

export type Occupancy = 'VACANT' | 'BOOKED' | 'OCCUPIED'
export type TenancyStatus = 'PENDING' | 'ACTIVE' | 'ENDED'

export interface RoomStatusInput {
  occupancy: Occupancy
  tenancy: { status: TenancyStatus; expiresAt: string | null } | null
  oldestUnpaidInvoice: { dueDate: string } | null
  now: Date
}

/** Days before dueDate at which an unpaid invoice flips from paid to due. */
export const DUE_WINDOW_DAYS = 3

/**
 * Edge semantics (all in WIB calendar days):
 * - PENDING hold expires only when expiresAt < now (strictly); expiresAt === now is still booking.
 * - today < dueDate - 3  -> paid
 * - dueDate - 3 <= today <= dueDate -> due (due today is still due)
 * - today > dueDate -> overdue
 * `occupancy` is accepted for the caller's convenience but status derives from tenancy.
 */
export function deriveRoomStatus(input: RoomStatusInput): RoomStatus {
  const { tenancy, oldestUnpaidInvoice, now } = input
  if (!tenancy || tenancy.status === 'ENDED') return 'vacant'
  if (tenancy.status === 'PENDING') {
    if (tenancy.expiresAt !== null && new Date(tenancy.expiresAt).getTime() < now.getTime()) return 'vacant'
    return 'booking'
  }
  if (!oldestUnpaidInvoice) return 'paid'
  const today = todayWIB(now)
  const { dueDate } = oldestUnpaidInvoice
  if (compareDates(today, dueDate) > 0) return 'overdue'
  if (compareDates(today, addDays(dueDate, -DUE_WINDOW_DAYS)) < 0) return 'paid'
  return 'due'
}

/** Whole WIB days past dueDate; 0 when not past due. */
export function daysOverdue(dueDate: string, now: Date): number {
  return Math.max(0, diffDays(dueDate, todayWIB(now)))
}
