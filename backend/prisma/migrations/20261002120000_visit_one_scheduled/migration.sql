-- Hand-written (Prisma cannot express partial indexes without the preview flag, see 20261001165632_constraints).
-- A student has at most one SCHEDULED visit per kos; cancelled and completed visits do not count.
CREATE UNIQUE INDEX visit_one_scheduled_per_user_kos ON "Visit"("userId", "kosId") WHERE status = 'SCHEDULED';
