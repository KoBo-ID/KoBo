-- Student profile (emergency contact + consent), terms version, notification opt-out, owner ownership declaration,
-- tenant-profile view audit, and the payment-reminder log (idempotent per invoice, kind and channel).
--
-- Down:  DROP TABLE "NotificationLog"; DROP TABLE "TenantProfileView";
--        ALTER TABLE "OwnerProfile" DROP COLUMN "ownershipType", DROP COLUMN "ownershipDeclaredAt";
--        ALTER TABLE "User" DROP COLUMN "emergencyContactName", DROP COLUMN "emergencyContactRelation", DROP COLUMN "emergencyContactPhone",
--          DROP COLUMN "emergencyContactConsentAt", DROP COLUMN "notifyOptOut", DROP COLUMN "termsVersion", DROP COLUMN "termsAcceptedAt";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emergencyContactName" TEXT,
ADD COLUMN "emergencyContactRelation" TEXT,
ADD COLUMN "emergencyContactPhone" TEXT,
ADD COLUMN "emergencyContactConsentAt" TIMESTAMPTZ(3),
ADD COLUMN "notifyOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "termsVersion" TEXT,
ADD COLUMN "termsAcceptedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "OwnerProfile" ADD COLUMN "ownershipType" TEXT,
ADD COLUMN "ownershipDeclaredAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "TenantProfileView" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "tenantUserId" TEXT NOT NULL,
    "kosId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantProfileView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantProfileView_tenantUserId_createdAt_idx" ON "TenantProfileView"("tenantUserId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_invoiceId_idx" ON "NotificationLog"("invoiceId");

-- CreateIndex: one send per invoice, kind and channel (the idempotency key)
CREATE UNIQUE INDEX "NotificationLog_invoiceId_kind_channel_key" ON "NotificationLog"("invoiceId", "kind", "channel");

-- AddForeignKey
ALTER TABLE "TenantProfileView" ADD CONSTRAINT "TenantProfileView_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantProfileView" ADD CONSTRAINT "TenantProfileView_tenantUserId_fkey" FOREIGN KEY ("tenantUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
