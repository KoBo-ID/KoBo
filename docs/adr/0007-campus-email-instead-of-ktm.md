# 0007. Campus-email verification instead of KTM scans

**Context.** The student discount needs proof of enrolment. KTM scans need a private bucket, an admin role and UI, Cloudflare Access and handling of national-ID images (about 25-30 hours, plus risk).

**Decision.** A student verifies a `*.ac.id` address matching a known campus domain by clicking a signed emailed link, which sets `campusEmailVerifiedAt`. The server alone computes the discount. The seeded demo student is pre-verified so the discount works even if campus mail quarantines us.

**Consequences.** No ID images and no admin surface. Students without a campus email cannot get the discount until a later fallback (KTM review is on the out-of-scope list). Reviews snapshot the verified flag at write time.
