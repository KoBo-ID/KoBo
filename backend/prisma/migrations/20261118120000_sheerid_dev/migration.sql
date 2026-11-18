-- AlterEnum
ALTER TYPE "CampusVerifyMethod" ADD VALUE 'SHEERID';

-- CreateEnum
CREATE TYPE "SheerIdStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "SheerIdVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "campusId" TEXT,
    "status" "SheerIdStatus" NOT NULL DEFAULT 'PENDING',
    "lastStep" TEXT,
    "errorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consentVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),
    "purgedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SheerIdVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SheerIdVerification_verificationId_key" ON "SheerIdVerification"("verificationId");

-- CreateIndex
CREATE INDEX "SheerIdVerification_userId_createdAt_idx" ON "SheerIdVerification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "SheerIdVerification" ADD CONSTRAINT "SheerIdVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
