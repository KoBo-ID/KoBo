-- Campus: nationwide catalogue fields. All nullable (the hand-seeded rows keep working); `dataVersion` marks rows loaded by
-- `catalog:import`, which resetDb leaves alone.
--
-- Down:  DROP INDEX "Campus_lat_lng_idx", "Campus_desaCode_idx";
--        ALTER TABLE "Campus" DROP COLUMN "pddiktiId", DROP COLUMN "osmId", ... (every column added below).

-- AlterTable
ALTER TABLE "Campus" ADD COLUMN "pddiktiId" TEXT,
ADD COLUMN "osmId" TEXT,
ADD COLUMN "wikidataId" TEXT,
ADD COLUMN "kind" TEXT,
ADD COLUMN "parentId" TEXT,
ADD COLUMN "desaCode" TEXT,
ADD COLUMN "gateLat" DOUBLE PRECISION,
ADD COLUMN "gateLng" DOUBLE PRECISION,
ADD COLUMN "coordMethod" TEXT,
ADD COLUMN "verifiedAt" TIMESTAMPTZ(3),
ADD COLUMN "website" TEXT,
ADD COLUMN "aliases" TEXT[],
ADD COLUMN "dataVersion" TEXT;

-- CreateIndex
CREATE INDEX "Campus_lat_lng_idx" ON "Campus"("lat", "lng");

-- CreateIndex
CREATE INDEX "Campus_desaCode_idx" ON "Campus"("desaCode");

-- A surveyed gate has both coordinates or neither.
ALTER TABLE "Campus" ADD CONSTRAINT campus_gate_pair CHECK (("gateLat" IS NULL) = ("gateLng" IS NULL));
