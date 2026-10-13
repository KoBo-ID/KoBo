-- CreateEnum
CREATE TYPE "RentalApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "RentalApplication" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RentalApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" DATE NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "occupation" TEXT NOT NULL,
    "note" TEXT,
    "tenancyId" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RentalApplication_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_application_duration_positive" CHECK ("durationMonths" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalApplication_tenancyId_key" ON "RentalApplication"("tenancyId");
CREATE INDEX "RentalApplication_roomId_status_createdAt_idx" ON "RentalApplication"("roomId", "status", "createdAt");
CREATE INDEX "RentalApplication_userId_createdAt_idx" ON "RentalApplication"("userId", "createdAt");

-- Hand-written partial index: history stays visible while duplicate pending submissions are impossible.
CREATE UNIQUE INDEX rental_application_one_pending_per_user_room
ON "RentalApplication"("userId", "roomId") WHERE status = 'PENDING';

-- AddForeignKey
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RentalApplication" ADD CONSTRAINT "RentalApplication_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
