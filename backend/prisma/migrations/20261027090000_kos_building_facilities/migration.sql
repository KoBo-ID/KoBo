ALTER TABLE "Kos" ADD COLUMN "floors" INTEGER,
 ADD COLUMN "yearBuilt" INTEGER,
 ADD COLUMN "buildingAreaM2" INTEGER,
 ADD COLUMN "facilities" JSONB;

ALTER TABLE "OwnerProfile" ADD COLUMN "approvedAt" TIMESTAMPTZ(3);
-- Owners that exist today are grandfathered in; only owners who register from now on wait for approval.
UPDATE "OwnerProfile" SET "approvedAt" = now();
