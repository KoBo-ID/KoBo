-- Paid history must outlive the listing. A kos or room that ever had a tenancy is archived (hidden), not deleted.
-- The application does this; the foreign key makes the database enforce it, so a delete that races a settlement or a
-- new application fails instead of cascading through Tenancy, Invoice and Payment.
ALTER TABLE "Kos" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
ALTER TABLE "Room" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);

-- Swapping the constraint (ON DELETE CASCADE to RESTRICT) needs a DROP; no data is touched. Commit message must carry "allow-destructive" for the DDL gate.
ALTER TABLE "Tenancy" DROP CONSTRAINT "Tenancy_roomId_fkey";
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One verified campus mailbox per account (the application check is check-then-update and can race). Hand-written partial
-- index, like the other partial unique indexes (ADR-0004). Fails loudly if two verified accounts already share a mailbox.
CREATE UNIQUE INDEX "User_campusEmail_verified_key" ON "User" (lower("campusEmail")) WHERE "campusEmailVerifiedAt" IS NOT NULL AND "campusEmail" IS NOT NULL;
