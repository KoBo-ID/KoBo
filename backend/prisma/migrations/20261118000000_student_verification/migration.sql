-- CreateEnum
CREATE TYPE "CampusVerifyMethod" AS ENUM ('EMAIL', 'MICROSOFT', 'GOOGLE', 'KTM');

-- CreateEnum
CREATE TYPE "StudentDocumentKind" AS ENUM ('KTM');

-- CreateEnum
CREATE TYPE "StudentDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Campus" ADD COLUMN     "entraTenantIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "studentEmailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "RentalApplication" ADD COLUMN     "program" TEXT,
ADD COLUMN     "semester" INTEGER,
ALTER COLUMN "occupation" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "campusIdpSubject" TEXT,
ADD COLUMN     "campusIdpTenant" TEXT,
ADD COLUMN     "campusVerifiedUntil" TIMESTAMPTZ(3),
ADD COLUMN     "campusVerifiedVia" "CampusVerifyMethod";

-- CreateTable
CREATE TABLE "StudentDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campusId" TEXT,
    "kind" "StudentDocumentKind" NOT NULL DEFAULT 'KTM',
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "status" "StudentDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "nim" TEXT,
    "nameOnCard" TEXT,
    "validUntil" DATE,
    "reviewer" TEXT,
    "reason" TEXT,
    "consentAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),
    "deleteAfter" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "StudentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampusEmailChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampusEmailChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentDocument_status_createdAt_idx" ON "StudentDocument"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StudentDocument_deleteAfter_idx" ON "StudentDocument"("deleteAfter");

-- CreateIndex
CREATE INDEX "CampusEmailChallenge_userId_createdAt_idx" ON "CampusEmailChallenge"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampusEmailChallenge" ADD CONSTRAINT "CampusEmailChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: partial unique indexes (Prisma cannot express them).
-- One campus identity (tenant + subject) maps to at most one user.
CREATE UNIQUE INDEX "User_campusIdp_key" ON "User"("campusIdpTenant", "campusIdpSubject") WHERE "campusIdpTenant" IS NOT NULL AND "campusIdpSubject" IS NOT NULL;

-- At most one live pending KTM per user.
CREATE UNIQUE INDEX "StudentDocument_one_pending_key" ON "StudentDocument"("userId") WHERE "status" = 'PENDING' AND "deletedAt" IS NULL;

-- Backfill: users verified before this migration were verified by campus email; every method now expires.
UPDATE "User" SET "campusVerifiedVia" = 'EMAIL', "campusVerifiedUntil" = now() + interval '12 months' WHERE "campusEmailVerifiedAt" IS NOT NULL;

-- Curated student mail domains for the hand-seeded campuses (ui-depok, untirta-serang and unej-jember stay empty).
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['binus.ac.id'] WHERE "id" IN ('binus-syahdan', 'binus-anggrek', 'binus-kijang');
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['students.itb.ac.id'] WHERE "id" = 'itb-ganesha';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['apps.ipb.ac.id'] WHERE "id" = 'ipb-dramaga';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['student.umn.ac.id'] WHERE "id" = 'umn-gading-serpong';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['mail.ugm.ac.id'] WHERE "id" = 'ugm-bulaksumur';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['student.uns.ac.id'] WHERE "id" = 'uns-kentingan';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['student.its.ac.id'] WHERE "id" = 'its-sukolilo';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['student.ub.ac.id'] WHERE "id" = 'ub-malang';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['student.unsoed.ac.id', 'mhs.unsoed.ac.id'] WHERE "id" = 'unsoed-purwokerto';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['students.undip.ac.id'] WHERE "id" = 'undip-tembalang';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['student.president.ac.id'] WHERE "id" = 'president-university';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['student.unsil.ac.id'] WHERE "id" = 'unsil-tasikmalaya';
UPDATE "Campus" SET "studentEmailDomains" = ARRAY['student.uksw.edu'] WHERE "id" = 'uksw-salatiga';

-- Microsoft Entra tenant ids (Binus, ITB, Undip, ITS).
UPDATE "Campus" SET "entraTenantIds" = ARRAY['3485b963-82ba-4a6f-810f-b5cc226ff898'] WHERE "id" IN ('binus-syahdan', 'binus-anggrek', 'binus-kijang');
UPDATE "Campus" SET "entraTenantIds" = ARRAY['db6e1183-4c65-405c-82ce-7cd53fa6e9dc'] WHERE "id" = 'itb-ganesha';
UPDATE "Campus" SET "entraTenantIds" = ARRAY['03290435-ff74-45d1-aeaa-173677221cf8'] WHERE "id" = 'undip-tembalang';
UPDATE "Campus" SET "entraTenantIds" = ARRAY['1d5169ac-c7cb-4275-9764-bf8c9c364a4c'] WHERE "id" = 'its-sukolilo';
