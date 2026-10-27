-- Kos.desaCode / regionConfidence (written when a kos is created or its pin moves; `catalog:backfill` fills existing rows once
-- the Region table is loaded) and CatalogMeta (which dataset versions are loaded and which is active).
--
-- Down:  DROP INDEX "Kos_desaCode_idx", kos_desacode_prefix_idx; ALTER TABLE "Kos" DROP COLUMN "desaCode", DROP COLUMN "regionConfidence"; DROP TABLE "CatalogMeta";

-- AlterTable
ALTER TABLE "Kos" ADD COLUMN "desaCode" TEXT,
ADD COLUMN "regionConfidence" TEXT;

-- CreateTable
CREATE TABLE "CatalogMeta" (
    "version" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "checksum" TEXT,
    "loadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceSummary" JSONB,

    CONSTRAINT "CatalogMeta_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE INDEX "Kos_desaCode_idx" ON "Kos"("desaCode");

-- Hand-written: prefix search (LIKE '36.74.%') needs the pattern operator class when the database collation is not C.
CREATE INDEX kos_desacode_prefix_idx ON "Kos"("desaCode" text_pattern_ops);
