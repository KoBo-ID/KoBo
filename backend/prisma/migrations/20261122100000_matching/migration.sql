-- CreateEnum
CREATE TYPE "MatchGender" AS ENUM ('LAKI_LAKI', 'PEREMPUAN');

-- CreateEnum
CREATE TYPE "SleepPref" AS ENUM ('AWAL', 'NORMAL', 'MALAM', 'BEBAS');

-- CreateEnum
CREATE TYPE "TidinessPref" AS ENUM ('SANTAI', 'CUKUP', 'RAPI', 'BEBAS');

-- CreateEnum
CREATE TYPE "SmokingPref" AS ENUM ('MEROKOK', 'TIDAK_MEROKOK_TOLERAN', 'TIDAK_MAU_PEROKOK', 'BEBAS');

-- CreateEnum
CREATE TYPE "GuestsPref" AS ENUM ('JARANG', 'KADANG', 'SERING', 'BEBAS');

-- CreateEnum
CREATE TYPE "NoisePref" AS ENUM ('TENANG', 'SEDANG', 'RAMAI', 'BEBAS');

-- CreateEnum
CREATE TYPE "SocialPref" AS ENUM ('INTROVERT', 'SEIMBANG', 'EKSTROVERT', 'BEBAS');

-- CreateEnum
CREATE TYPE "StudyPref" AS ENUM ('DI_KAMAR', 'CAMPUR', 'DI_LUAR', 'BEBAS');

-- CreateEnum
CREATE TYPE "AcPref" AS ENUM ('SELALU', 'MALAM_SAJA', 'TANPA_AC', 'BEBAS');

-- CreateEnum
CREATE TYPE "ExpensesPref" AS ENUM ('PATUNGAN', 'SEBAGIAN', 'TERPISAH', 'BEBAS');

-- CreateEnum
CREATE TYPE "PartnerRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PartnerEndReason" AS ENUM ('ENDED_BY_USER', 'BLOCKED', 'PROFILE_DELETED', 'SELESAI');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('PELECEHAN', 'SPAM_PENIPUAN', 'PROFIL_PALSU', 'KONTEN_TIDAK_PANTAS', 'LAINNYA');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "maxOccupants" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pricePerPersonMonthly" INTEGER;

-- CreateTable
CREATE TABLE "MatchingProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "displayName" TEXT NOT NULL,
    "intro" TEXT NOT NULL DEFAULT '',
    "gender" "MatchGender" NOT NULL,
    "birthYear" INTEGER NOT NULL,
    "campusId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "pausedAt" TIMESTAMPTZ(3),
    "emailOptOut" BOOLEAN NOT NULL DEFAULT false,
    "lastActiveAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiddenByReportsAt" TIMESTAMPTZ(3),
    "budgetMin" INTEGER NOT NULL,
    "budgetMax" INTEGER NOT NULL,
    "anchorLat" DOUBLE PRECISION NOT NULL,
    "anchorLng" DOUBLE PRECISION NOT NULL,
    "anchorLabel" TEXT NOT NULL,
    "radiusKm" INTEGER NOT NULL DEFAULT 3,
    "moveInDate" DATE NOT NULL,
    "durationMonths" INTEGER NOT NULL DEFAULT 12,
    "kosType" "KosGender" NOT NULL DEFAULT 'CAMPUR',
    "roomShare" INTEGER NOT NULL DEFAULT 2,
    "sleep" "SleepPref" NOT NULL DEFAULT 'BEBAS',
    "tidiness" "TidinessPref" NOT NULL DEFAULT 'BEBAS',
    "smoking" "SmokingPref" NOT NULL,
    "guests" "GuestsPref" NOT NULL DEFAULT 'BEBAS',
    "noise" "NoisePref" NOT NULL DEFAULT 'BEBAS',
    "social" "SocialPref" NOT NULL DEFAULT 'BEBAS',
    "study" "StudyPref" NOT NULL DEFAULT 'BEBAS',
    "ac" "AcPref" NOT NULL DEFAULT 'BEBAS',
    "expenses" "ExpensesPref" NOT NULL DEFAULT 'BEBAS',

    CONSTRAINT "MatchingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerRequest" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" "PartnerRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PartnerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerConnection" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "endedById" TEXT,
    "endReason" "PartnerEndReason",

    CONSTRAINT "PartnerConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerMessage" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "hadContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionReadState" (
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDigestAt" TIMESTAMPTZ(3),

    CONSTRAINT "ConnectionReadState_pkey" PRIMARY KEY ("connectionId","userId")
);

-- CreateTable
CREATE TABLE "SharedShortlistItem" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kosId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedShortlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "connectionId" TEXT,
    "messageId" TEXT,
    "snapshot" JSONB,
    "countsForHide" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewer" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchingProfile_userId_key" ON "MatchingProfile"("userId");

-- CreateIndex
CREATE INDEX "MatchingProfile_active_lastActiveAt_idx" ON "MatchingProfile"("active", "lastActiveAt");

-- CreateIndex
CREATE INDEX "PartnerRequest_toUserId_status_idx" ON "PartnerRequest"("toUserId", "status");

-- CreateIndex
CREATE INDEX "PartnerRequest_fromUserId_status_idx" ON "PartnerRequest"("fromUserId", "status");

-- CreateIndex
CREATE INDEX "PartnerRequest_status_expiresAt_idx" ON "PartnerRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerConnection_requestId_key" ON "PartnerConnection"("requestId");

-- CreateIndex
CREATE INDEX "PartnerConnection_userAId_endedAt_idx" ON "PartnerConnection"("userAId", "endedAt");

-- CreateIndex
CREATE INDEX "PartnerConnection_userBId_endedAt_idx" ON "PartnerConnection"("userBId", "endedAt");

-- CreateIndex
CREATE INDEX "PartnerMessage_connectionId_createdAt_idx" ON "PartnerMessage"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerMessage_senderId_idx" ON "PartnerMessage"("senderId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedShortlistItem_connectionId_kosId_key" ON "SharedShortlistItem"("connectionId", "kosId");

-- CreateIndex
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "UserReport_status_createdAt_idx" ON "UserReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "UserReport_reportedId_status_idx" ON "UserReport"("reportedId", "status");

-- AddForeignKey
ALTER TABLE "MatchingProfile" ADD CONSTRAINT "MatchingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerRequest" ADD CONSTRAINT "PartnerRequest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerRequest" ADD CONSTRAINT "PartnerRequest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerConnection" ADD CONSTRAINT "PartnerConnection_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerConnection" ADD CONSTRAINT "PartnerConnection_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerConnection" ADD CONSTRAINT "PartnerConnection_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PartnerRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerMessage" ADD CONSTRAINT "PartnerMessage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PartnerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerMessage" ADD CONSTRAINT "PartnerMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionReadState" ADD CONSTRAINT "ConnectionReadState_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PartnerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionReadState" ADD CONSTRAINT "ConnectionReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedShortlistItem" ADD CONSTRAINT "SharedShortlistItem_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PartnerConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedShortlistItem" ADD CONSTRAINT "SharedShortlistItem_kosId_fkey" FOREIGN KEY ("kosId") REFERENCES "Kos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand SQL: rules Prisma cannot express (db:diff ignores them, like tenancy_one_active_per_room).

-- One PENDING request per unordered pair (A to B and B to A count as the same pair).
CREATE UNIQUE INDEX partner_request_one_pending_per_pair
  ON "PartnerRequest" (LEAST("fromUserId", "toUserId"), GREATEST("fromUserId", "toUserId"))
  WHERE status = 'PENDING';

-- One live connection per pair; the pair is stored ordered.
CREATE UNIQUE INDEX partner_connection_one_live_per_pair ON "PartnerConnection"("userAId", "userBId") WHERE "endedAt" IS NULL;
ALTER TABLE "PartnerConnection" ADD CONSTRAINT partner_connection_ordered CHECK ("userAId" < "userBId");

ALTER TABLE "PartnerRequest" ADD CONSTRAINT partner_request_not_self CHECK ("fromUserId" <> "toUserId");
ALTER TABLE "UserBlock" ADD CONSTRAINT user_block_not_self CHECK ("blockerId" <> "blockedId");
ALTER TABLE "UserReport" ADD CONSTRAINT user_report_not_self CHECK ("reporterId" <> "reportedId");

ALTER TABLE "MatchingProfile" ADD CONSTRAINT matching_profile_budget_range CHECK ("budgetMin" >= 0 AND "budgetMin" <= "budgetMax");
ALTER TABLE "MatchingProfile" ADD CONSTRAINT matching_profile_radius CHECK ("radiusKm" BETWEEN 1 AND 15);
ALTER TABLE "MatchingProfile" ADD CONSTRAINT matching_profile_duration CHECK ("durationMonths" BETWEEN 1 AND 12);
ALTER TABLE "MatchingProfile" ADD CONSTRAINT matching_profile_room_share CHECK ("roomShare" IN (2, 3));

-- Room capacity: 1..4 people; a per-person price, when set, is positive.
ALTER TABLE "Room" ADD CONSTRAINT room_max_occupants CHECK ("maxOccupants" BETWEEN 1 AND 4);
ALTER TABLE "Room" ADD CONSTRAINT room_price_per_person_positive CHECK ("pricePerPersonMonthly" IS NULL OR "pricePerPersonMonthly" > 0);
