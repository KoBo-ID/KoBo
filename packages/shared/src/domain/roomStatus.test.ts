import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { daysOverdue, deriveRoomStatus, type RoomStatusInput } from './roomStatus.ts'

const NOW = new Date('2026-10-15T05:00:00Z') // 2026-10-15 12:00 WIB
const active = (due: string | null, now = NOW): RoomStatusInput => ({
  occupancy: 'OCCUPIED',
  tenancy: { status: 'ACTIVE', expiresAt: null },
  oldestUnpaidInvoice: due ? { dueDate: due } : null,
  now,
})
const pending = (expiresAt: string | null): RoomStatusInput => ({
  occupancy: 'BOOKED',
  tenancy: { status: 'PENDING', expiresAt },
  oldestUnpaidInvoice: null,
  now: NOW,
})

describe('deriveRoomStatus', () => {
  it('no tenancy is vacant', () => {
    expect(deriveRoomStatus({ occupancy: 'VACANT', tenancy: null, oldestUnpaidInvoice: null, now: NOW })).toBe('vacant')
  })
  it('ENDED is vacant', () => {
    expect(
      deriveRoomStatus({ occupancy: 'VACANT', tenancy: { status: 'ENDED', expiresAt: null }, oldestUnpaidInvoice: null, now: NOW }),
    ).toBe('vacant')
  })
  it('PENDING within hold is booking', () => {
    expect(deriveRoomStatus(pending('2026-10-15T05:00:01Z'))).toBe('booking')
  })
  it('PENDING with expiresAt exactly now is still booking (expired only when expiresAt < now)', () => {
    expect(deriveRoomStatus(pending(NOW.toISOString()))).toBe('booking')
  })
  it('PENDING past expiresAt is vacant', () => {
    expect(deriveRoomStatus(pending('2026-10-15T04:59:59Z'))).toBe('vacant')
  })
  it('PENDING with null expiresAt is booking', () => {
    expect(deriveRoomStatus(pending(null))).toBe('booking')
  })
  it('ACTIVE without unpaid invoice is paid', () => {
    expect(deriveRoomStatus(active(null))).toBe('paid')
  })
  it('due far in the future is paid', () => {
    expect(deriveRoomStatus(active('2026-10-30'))).toBe('paid')
    expect(deriveRoomStatus(active('2026-10-19'))).toBe('paid') // today < due-3 (10-16)
  })
  it('exactly 3 days before due is due', () => {
    expect(deriveRoomStatus(active('2026-10-18'))).toBe('due')
  })
  it('due today is due', () => {
    expect(deriveRoomStatus(active('2026-10-15'))).toBe('due')
  })
  it('one day after due is overdue', () => {
    expect(deriveRoomStatus(active('2026-10-14'))).toBe('overdue')
  })
  it('WIB midnight boundary flips due to overdue', () => {
    const due = '2026-10-15'
    expect(deriveRoomStatus(active(due, new Date('2026-10-15T16:59:59Z')))).toBe('due')
    expect(deriveRoomStatus(active(due, new Date('2026-10-15T17:00:00Z')))).toBe('overdue')
  })
  it('WIB midnight boundary flips paid to due 3 days before', () => {
    const due = '2026-10-18'
    expect(deriveRoomStatus(active(due, new Date('2026-10-14T16:59:59Z')))).toBe('paid')
    expect(deriveRoomStatus(active(due, new Date('2026-10-14T17:00:00Z')))).toBe('due')
  })

  it('property: ACTIVE status is monotone in time (paid -> due -> overdue)', () => {
    const rank = { paid: 0, due: 1, overdue: 2 } as const
    const d = fc.date({ min: new Date('2026-01-01'), max: new Date('2027-01-01'), noInvalidDate: true })
    fc.assert(
      fc.property(d, fc.integer({ min: 0, max: 5 * 24 * 3600_000 }), d, (t, dt, dueD) => {
        const due = dueD.toISOString().slice(0, 10)
        const a = deriveRoomStatus(active(due, t)) as keyof typeof rank
        const b = deriveRoomStatus(active(due, new Date(t.getTime() + dt))) as keyof typeof rank
        expect(rank[b]).toBeGreaterThanOrEqual(rank[a])
      }),
    )
  })
  it('property: ENDED/null tenancy is always vacant', () => {
    fc.assert(
      fc.property(fc.date({ noInvalidDate: true }), fc.constantFrom('VACANT' as const, 'BOOKED' as const, 'OCCUPIED' as const), (now, occupancy) => {
        expect(deriveRoomStatus({ occupancy, tenancy: null, oldestUnpaidInvoice: null, now })).toBe('vacant')
        expect(
          deriveRoomStatus({ occupancy, tenancy: { status: 'ENDED', expiresAt: null }, oldestUnpaidInvoice: { dueDate: '2026-01-01' }, now }),
        ).toBe('vacant')
      }),
    )
  })
})

describe('daysOverdue', () => {
  it('is 0 on or before due date', () => {
    expect(daysOverdue('2026-10-15', NOW)).toBe(0)
    expect(daysOverdue('2026-10-20', NOW)).toBe(0)
  })
  it('counts WIB days after due date', () => {
    expect(daysOverdue('2026-10-14', NOW)).toBe(1)
    expect(daysOverdue('2026-10-05', NOW)).toBe(10)
    expect(daysOverdue('2026-10-15', new Date('2026-10-15T17:00:00Z'))).toBe(1)
  })
  it('property: non-negative, and > 0 iff status overdue', () => {
    const d = fc.date({ min: new Date('2026-01-01'), max: new Date('2027-01-01'), noInvalidDate: true })
    fc.assert(
      fc.property(d, d, (now, dueD) => {
        const due = dueD.toISOString().slice(0, 10)
        const n = daysOverdue(due, now)
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n > 0).toBe(deriveRoomStatus(active(due, now)) === 'overdue')
      }),
    )
  })
})
