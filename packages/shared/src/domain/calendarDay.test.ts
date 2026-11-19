import { describe, expect, it } from 'vitest'
import { isCalendarDay, parseCalendarDay } from './calendarDay.ts'

describe('calendar day', () => {
  it('accepts real days', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true)
    expect(isCalendarDay('2026-12-31')).toBe(true)
    expect(parseCalendarDay('2026-11-30')).toEqual({ y: 2026, m: 11, d: 30 })
  })
  it('rejects impossible days and bad shapes', () => {
    for (const s of ['2026-11-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-01', '', 'abc']) {
      expect(isCalendarDay(s)).toBe(false)
      expect(parseCalendarDay(s)).toBeNull()
    }
  })
})
