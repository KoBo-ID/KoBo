-- B-08 guard: rent prices are now at least Rp 1 in the API.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Room" WHERE "priceMonthly" < 1) THEN RAISE EXCEPTION 'B-08: rooms with priceMonthly < 1 exist; fix them before migrating'; END IF; END $$;

-- StudentDocument.key must be unique: abort with a clear message if duplicates exist.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "StudentDocument" GROUP BY "key" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'StudentDocument.key has duplicate values; deduplicate them before migrating';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Tenancy" ADD COLUMN     "agreedMonthlyRent" INTEGER;

-- A-006 back-fill: the rent of each tenancy's earliest invoice.
UPDATE "Tenancy" t SET "agreedMonthlyRent" = i."rentAmount"
FROM (
  SELECT DISTINCT ON ("tenancyId") "tenancyId", "rentAmount"
  FROM "Invoice"
  ORDER BY "tenancyId", "dueDate" ASC, "periodStart" ASC, "id" ASC
) i
WHERE i."tenancyId" = t."id";

-- AlterTable
ALTER TABLE "WaitlistEntry" ADD COLUMN     "applicationId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "StudentDocument_key_key" ON "StudentDocument"("key");

-- CreateIndex
CREATE INDEX "StudentDocument_userId_deletedAt_createdAt_idx" ON "StudentDocument"("userId", "deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_applicationId_key" ON "WaitlistEntry"("applicationId");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RentalApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written partial indexes (not in schema.prisma; the partialIndexes preview stays off).
CREATE INDEX "WaitlistEntry_live_kosId_createdAt_idx" ON "WaitlistEntry"("kosId", "createdAt") WHERE "status" IN ('WAITING', 'OFFERED');
CREATE INDEX "Payment_pending_provider_status_createdAt_idx" ON "Payment"("provider", "status", "createdAt") WHERE "status" = 'PENDING';
-- Trigram indexes deferred: no ILIKE '%q%' queries on indexed columns and no pg_trgm extension.
