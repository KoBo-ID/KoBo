-- Per-kos snapshot of what is nearby, stored as references to PlaceCatalog / OwnerPlace / Campus rows (no copies, no foreign
-- key to the reloadable catalogue), the owner decisions about places, and places owners add.
--
-- Down:  DROP TABLE "OwnerPlace"; DROP TABLE "PlaceOverlay"; DROP TABLE "KosPlace";

-- CreateTable
CREATE TABLE "KosPlace" (
    "id" TEXT NOT NULL,
    "kosId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "catalogVersion" TEXT NOT NULL,
    "hiddenByOwner" BOOLEAN NOT NULL DEFAULT false,
    "addedByOwner" BOOLEAN NOT NULL DEFAULT false,
    "sourceLabel" TEXT NOT NULL,

    CONSTRAINT "KosPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaceOverlay" (
    "id" TEXT NOT NULL,
    "kosId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "override" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceOverlay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerPlace" (
    "id" TEXT NOT NULL,
    "kosId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerPlace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KosPlace_kosId_idx" ON "KosPlace"("kosId");

-- CreateIndex
CREATE UNIQUE INDEX "KosPlace_kosId_placeId_key" ON "KosPlace"("kosId", "placeId");

-- CreateIndex
CREATE INDEX "PlaceOverlay_kosId_idx" ON "PlaceOverlay"("kosId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaceOverlay_kosId_placeId_override_key" ON "PlaceOverlay"("kosId", "placeId", "override");

-- CreateIndex
CREATE INDEX "OwnerPlace_kosId_idx" ON "OwnerPlace"("kosId");

-- CreateIndex
CREATE INDEX "OwnerPlace_status_idx" ON "OwnerPlace"("status");

-- AddForeignKey
ALTER TABLE "KosPlace" ADD CONSTRAINT "KosPlace_kosId_fkey" FOREIGN KEY ("kosId") REFERENCES "Kos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceOverlay" ADD CONSTRAINT "PlaceOverlay_kosId_fkey" FOREIGN KEY ("kosId") REFERENCES "Kos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerPlace" ADD CONSTRAINT "OwnerPlace_kosId_fkey" FOREIGN KEY ("kosId") REFERENCES "Kos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written value rules.
ALTER TABLE "KosPlace" ADD CONSTRAINT kosplace_distance_nonneg CHECK ("distanceM" >= 0);
ALTER TABLE "KosPlace" ADD CONSTRAINT kosplace_mode CHECK ("mode" IN ('walk', 'motor'));
ALTER TABLE "PlaceOverlay" ADD CONSTRAINT placeoverlay_override CHECK ("override" IN ('hide'));
ALTER TABLE "OwnerPlace" ADD CONSTRAINT ownerplace_status CHECK ("status" IN ('pending', 'approved', 'rejected'));
