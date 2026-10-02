# 0013. Scoped demo reset

**Context.** Shared public demo accounts get vandalised, but real sign-ups share the same database and must never be wiped.

**Decision.** `resetDemo(prisma, now)` restores only demo-owned state to the seed: the demo student's tenancies, visits and profile, and the demo owner's profile, kos edits, new kos, rooms, photos, rules and the seeded tenants, invoices, payments and reviews of those kos. A real user's live tenancy always wins over a seeded tenant. It runs nightly at 03:30 WIB (croner, started from `index.ts` only) and on demand through `demo.reset`, which only demo users may call. Demo sessions show a notice.

**Consequences.** The demo is self-healing without touching real data. Uploaded R2 objects of removed photos are orphaned. Receipt numbers of re-seeded payments change after a reset.
