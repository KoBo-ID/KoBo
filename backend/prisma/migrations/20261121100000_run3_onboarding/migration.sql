-- CreateEnum
CREATE TYPE "OwnerVerificationStatus" AS ENUM ('BELUM_KIRIM', 'MENUNGGU', 'DISETUJUI', 'DITOLAK');


-- CreateEnum
CREATE TYPE "OwnerDocumentKind" AS ENUM ('KTP', 'SHM', 'SHGB', 'AJB', 'GIRIK', 'SPPT_PBB', 'SURAT_KUASA', 'SURAT_KETERANGAN');

-- CreateEnum
CREATE TYPE "OwnerDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "OwnerProfile" ADD COLUMN     "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verificationReason" TEXT,
ADD COLUMN     "verificationStatus" "OwnerVerificationStatus" NOT NULL DEFAULT 'BELUM_KIRIM';

-- AlterTable
ALTER TABLE "StudentDocument" ADD COLUMN     "claimedValidUntil" DATE,
ADD COLUMN     "program" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "verifiedCampusId" TEXT;

-- CreateTable
CREATE TABLE "OwnerDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "OwnerDocumentKind" NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "status" "OwnerDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "consentAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),
    "reviewer" TEXT,
    "reason" TEXT,
    "deleteAfter" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "OwnerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampusAffiliation" (
    "id" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampusAffiliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerDocument_key_key" ON "OwnerDocument"("key");

-- CreateIndex
CREATE INDEX "OwnerDocument_userId_status_idx" ON "OwnerDocument"("userId", "status");

-- CreateIndex
CREATE INDEX "OwnerDocument_deleteAfter_idx" ON "OwnerDocument"("deleteAfter");

-- CreateIndex
CREATE UNIQUE INDEX "CampusAffiliation_campusId_key" ON "CampusAffiliation"("campusId");

-- AddForeignKey
ALTER TABLE "OwnerDocument" ADD CONSTRAINT "OwnerDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written backfills.
-- verifiedCampusId, in order of preference: latest APPROVED KTM campus, then the campus owning the campus-email domain
-- (EMAIL only), then the campus owning the IdP tenant (Entra tid, or google:<hd> matched against student domains).
UPDATE "User" u SET "verifiedCampusId" = d."campusId"
FROM (
  SELECT DISTINCT ON ("userId") "userId", "campusId" FROM "StudentDocument"
  WHERE "status" = 'APPROVED' AND "campusId" IS NOT NULL
  ORDER BY "userId", COALESCE("decidedAt", "createdAt") DESC
) d
WHERE d."userId" = u."id" AND u."campusVerifiedVia" IS NOT NULL;

UPDATE "User" u SET "verifiedCampusId" = c."id"
FROM (
  SELECT DISTINCT ON (u2."id") u2."id" AS "userId", c2."id"
  FROM "User" u2 JOIN "Campus" c2 ON lower(split_part(u2."campusEmail", '@', 2)) = ANY (c2."studentEmailDomains")
  WHERE u2."campusVerifiedVia" = 'EMAIL' AND u2."campusEmail" IS NOT NULL AND u2."verifiedCampusId" IS NULL
  ORDER BY u2."id", c2."id"
) c
WHERE c."userId" = u."id";

UPDATE "User" u SET "verifiedCampusId" = c."id"
FROM (
  SELECT DISTINCT ON (u2."id") u2."id" AS "userId", c2."id"
  FROM "User" u2 JOIN "Campus" c2 ON u2."campusIdpTenant" = ANY (c2."entraTenantIds")
    OR (u2."campusIdpTenant" LIKE 'google:%' AND substr(u2."campusIdpTenant", 8) = ANY (c2."studentEmailDomains"))
  WHERE u2."campusVerifiedVia" IS NOT NULL AND u2."campusIdpTenant" IS NOT NULL AND u2."verifiedCampusId" IS NULL
  ORDER BY u2."id", c2."id"
) c
WHERE c."userId" = u."id";

-- Owners approved before this release stay approved.
UPDATE "OwnerProfile" SET "verificationStatus" = 'DISETUJUI' WHERE "approvedAt" IS NOT NULL;
