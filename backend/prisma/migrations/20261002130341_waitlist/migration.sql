-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'FULFILLED', 'EXPIRED', 'DECLINED', 'LEFT', 'REMOVED');

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "kosId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomType" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "offeredRoomId" TEXT,
    "offerExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaitlistEntry_kosId_status_createdAt_idx" ON "WaitlistEntry"("kosId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_userId_idx" ON "WaitlistEntry"("userId");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_kosId_fkey" FOREIGN KEY ("kosId") REFERENCES "Kos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_offeredRoomId_fkey" FOREIGN KEY ("offeredRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written (partial indexes, see 20261001165632_constraints and ADR 0004).
-- One live entry (WAITING or OFFERED) per student per kos, and one live offer per room.
CREATE UNIQUE INDEX waitlist_one_live_per_user_kos ON "WaitlistEntry"("userId", "kosId") WHERE status IN ('WAITING', 'OFFERED');
CREATE UNIQUE INDEX waitlist_one_offer_per_room ON "WaitlistEntry"("offeredRoomId") WHERE status = 'OFFERED';
