/** Longest a student verification lasts: 12 months for every method (KTM: the reviewer date, at most this). */
export const STUDENT_VERIFICATION_MAX_DAYS = 365

/** Message prefix + PRECONDITION_FAILED: how the frontend recognises the gate (see errors.ts). */
export const STUDENT_VERIFICATION_REQUIRED = 'STUDENT_VERIFICATION_REQUIRED'

/** Verified = a campus verification was recorded and it has not expired. `until = null` (legacy) never expires. */
export function isStudentVerified(
  u: { campusEmailVerifiedAt: Date | string | null; campusVerifiedUntil?: Date | string | null },
  now: Date,
): boolean {
  // Legacy column name: set on every verification method (email, IdP, KTM, SheerID) to mark verified status (SIM-030).
  if (!u.campusEmailVerifiedAt) return false
  if (u.campusVerifiedUntil == null) return true
  return new Date(u.campusVerifiedUntil).getTime() > now.getTime()
}
