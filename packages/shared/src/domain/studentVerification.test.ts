import { describe, expect, it } from 'vitest'
import { isStudentVerified, STUDENT_VERIFICATION_MAX_DAYS } from './studentVerification.ts'

const now = new Date('2026-11-18T00:00:00Z')

describe('isStudentVerified', () => {
  it('is false when never verified', () => {
    expect(isStudentVerified({ campusEmailVerifiedAt: null }, now)).toBe(false)
    expect(isStudentVerified({ campusEmailVerifiedAt: null, campusVerifiedUntil: '2027-01-01T00:00:00Z' }, now)).toBe(false)
  })
  it('is true when verified with no expiry', () => {
    expect(isStudentVerified({ campusEmailVerifiedAt: new Date('2026-01-01') }, now)).toBe(true)
    expect(isStudentVerified({ campusEmailVerifiedAt: '2026-01-01T00:00:00Z', campusVerifiedUntil: null }, now)).toBe(true)
  })
  it('is true before the expiry and false from the expiry instant on', () => {
    const base = { campusEmailVerifiedAt: '2026-01-01T00:00:00Z' }
    expect(isStudentVerified({ ...base, campusVerifiedUntil: new Date(now.getTime() + 1) }, now)).toBe(true)
    expect(isStudentVerified({ ...base, campusVerifiedUntil: new Date(now.getTime()) }, now)).toBe(false)
    expect(isStudentVerified({ ...base, campusVerifiedUntil: new Date(now.getTime() - 1) }, now)).toBe(false)
  })
  it('accepts ISO strings', () => {
    const base = { campusEmailVerifiedAt: '2026-01-01T00:00:00Z' }
    expect(isStudentVerified({ ...base, campusVerifiedUntil: '2026-11-18T00:00:00.001Z' }, now)).toBe(true)
    expect(isStudentVerified({ ...base, campusVerifiedUntil: '2026-11-18T00:00:00.000Z' }, now)).toBe(false)
  })
  it('caps at 365 days', () => expect(STUDENT_VERIFICATION_MAX_DAYS).toBe(365))
})
