-- PlaceCatalog: places of interest (OSM-derived today). One row per source; never merged across sources (D3). No foreign keys to
-- app tables, so TRUNCATE ... CASCADE of the app can never reach it. Never a phone number column.
--
-- Down:  DROP VIEW v_osm_derived_places;  DROP TABLE "PlaceCatalog";

-- CreateTable
CREATE TABLE "PlaceCatalog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "name" TEXT NOT NULL,
    "nameAlt" TEXT,
    "brand" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "cell" TEXT NOT NULL,
    "desaCode" TEXT,
    "hoursRaw" TEXT,
    "website" TEXT,
    "osmType" TEXT,
    "osmId" BIGINT,
    "score" INTEGER NOT NULL,
    "licence" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "derivedFromOsm" BOOLEAN NOT NULL,
    "firstSeen" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3),
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "dataVersion" TEXT NOT NULL,

    CONSTRAINT "PlaceCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaceCatalog_source_sourceId_key" ON "PlaceCatalog"("source", "sourceId");

-- CreateIndex
CREATE INDEX "PlaceCatalog_category_cell_idx" ON "PlaceCatalog"("category", "cell");

-- CreateIndex
CREATE INDEX "PlaceCatalog_cell_idx" ON "PlaceCatalog"("cell");

-- CreateIndex
CREATE INDEX "PlaceCatalog_source_idx" ON "PlaceCatalog"("source");

-- CreateIndex
CREATE INDEX "PlaceCatalog_desaCode_idx" ON "PlaceCatalog"("desaCode");

-- Hand-written (Prisma cannot express these; the partialIndexes preview stays off, see 20261001165632_constraints).
CREATE INDEX placecatalog_osm_derived_idx ON "PlaceCatalog"("category") WHERE "derivedFromOsm";
ALTER TABLE "PlaceCatalog" ADD CONSTRAINT placecatalog_licence_filled CHECK (length("licence") > 0 AND length("attribution") > 0);
-- derivedFromOsm must agree with the source: an OSM row is flagged, a row from another source is not.
ALTER TABLE "PlaceCatalog" ADD CONSTRAINT placecatalog_osm_flag CHECK (("source" = 'osm') = "derivedFromOsm");

-- Every row that falls under the ODbL, for a share-alike export if one is ever required (D3).
CREATE VIEW v_osm_derived_places AS
SELECT * FROM "PlaceCatalog" WHERE "derivedFromOsm";
