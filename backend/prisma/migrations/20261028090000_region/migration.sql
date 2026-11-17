-- Region: Kemendagri administrative areas (provinsi .. desa/kelurahan), read-only reference data loaded by `catalog:import`.
-- No foreign keys to app tables on purpose (ADR 0016). Polygons: provinsi, kabupaten/kota and kecamatan only.
--
-- Down (manual, only before anything depends on it):  DROP TABLE "Region";

-- CreateTable
CREATE TABLE "Region" (
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parentCode" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "minLat" DOUBLE PRECISION,
    "maxLat" DOUBLE PRECISION,
    "minLng" DOUBLE PRECISION,
    "maxLng" DOUBLE PRECISION,
    "postalCode" TEXT,
    "polygon" JSONB,
    "polygonProvenance" TEXT,
    "dataVersion" TEXT NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "Region_level_parentCode_idx" ON "Region"("level", "parentCode");

-- CreateIndex
CREATE INDEX "Region_level_minLat_maxLat_idx" ON "Region"("level", "minLat", "maxLat");

-- CreateIndex
CREATE INDEX "Region_name_idx" ON "Region"("name");

-- Codes are the Kemendagri format: 2 digits, then 2 digits twice, then 4 digits for a desa/kelurahan.
ALTER TABLE "Region" ADD CONSTRAINT region_code_format CHECK ("code" ~ '^[0-9]{2}(\.[0-9]{2}){0,2}(\.[0-9]{4})?$');
ALTER TABLE "Region" ADD CONSTRAINT region_level_range CHECK ("level" BETWEEN 1 AND 4);
