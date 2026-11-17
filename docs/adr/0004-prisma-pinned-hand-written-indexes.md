# 0004. Prisma 7 pinned below 8, partial indexes as hand-written SQL

**Context.** Booking needs a database-level guarantee that a room has at most one live tenancy. Prisma 7.5 added savepoints (nested transactions); Prisma 8 changes transactions. The `partialIndexes` preview triggers a regeneration loop for enum `IN` predicates (#29386).

**Decision.** Pin Prisma `>=7.5 <8` with a Dependabot ignore for major versions. Express partial unique indexes (one live tenancy per room, one scheduled visit per student per kos) as hand-written SQL migrations, kept out of `schema.prisma`, and verify drift with `prisma migrate diff --exit-code`.

**Consequences.** Double booking is physically impossible, and the losing request gets a clear Indonesian conflict message. Upgrading to Prisma 8 is a deliberate project. A destructive-DDL grep gates risky migrations.
