import { describe, expect, it } from 'vitest'
import { nextDemoReset } from '../../src/demoSchedule.ts'

describe('nightly demo reset schedule', () => {
  it('fires at 03:30 WIB (20:30 UTC the evening before)', () => {
    expect(nextDemoReset(new Date('2026-10-02T10:00:00Z')).toISOString()).toBe('2026-10-02T20:30:00.000Z')
  })

  it('moves to the next night once 03:30 WIB has passed', () => {
    expect(nextDemoReset(new Date('2026-10-02T21:00:00Z')).toISOString()).toBe('2026-10-03T20:30:00.000Z')
  })
})
