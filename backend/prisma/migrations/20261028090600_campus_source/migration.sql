-- Campus: where an imported row comes from and under which licence, so OSM-derived campuses (ODbL) can be told apart and exported
-- separately like PlaceCatalog rows (D3). Seeded rows keep source and licence NULL and derivedFromOsm false.
--
-- Down:  DROP VIEW v_osm_derived_campuses;  ALTER TABLE "Campus" DROP COLUMN "source", DROP COLUMN "licence", DROP COLUMN "derivedFromOsm";

-- AlterTable
ALTER TABLE "Campus" ADD COLUMN "source" TEXT,
ADD COLUMN "licence" TEXT,
ADD COLUMN "derivedFromOsm" BOOLEAN NOT NULL DEFAULT false;

-- Hand-written: a flagged row must say it is OSM, and an OSM row must be flagged.
ALTER TABLE "Campus" ADD CONSTRAINT campus_osm_flag CHECK (("source" IS DISTINCT FROM 'osm') OR "derivedFromOsm");
ALTER TABLE "Campus" ADD CONSTRAINT campus_osm_flag_reverse CHECK (NOT "derivedFromOsm" OR "source" = 'osm');

-- Every campus row that falls under the ODbL.
CREATE VIEW v_osm_derived_campuses AS
SELECT * FROM "Campus" WHERE "derivedFromOsm";
