-- Gateway and marketplace readiness enums.
CREATE TYPE "GatewayFeeBearer" AS ENUM ('PLATFORM', 'OWNER', 'TENANT');
CREATE TYPE "ManualPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER');
CREATE TYPE "XenditOnboardingStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'RESTRICTED');
CREATE TYPE "PaymentWebhookResult" AS ENUM ('RECEIVED', 'APPLIED', 'IGNORED', 'REJECTED', 'FAILED');
CREATE TYPE "PaymentRefundStatus" AS ENUM ('PENDING', 'SUBMITTED', 'SUCCEEDED', 'FAILED');

ALTER TYPE "PaymentProvider" ADD VALUE 'XENDIT';
ALTER TYPE "PaymentStatus" ADD VALUE 'CREATING' BEFORE 'PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_FAILED';

-- Preserve the current total while introducing the immutable allocation snapshot.
ALTER TABLE "Invoice"
  ADD COLUMN "rentAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discountAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "applicationFeeAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ownerReceivableAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "gatewayFeeBearer" "GatewayFeeBearer" NOT NULL DEFAULT 'PLATFORM';

UPDATE "Invoice"
SET "rentAmount" = "amount",
    "ownerReceivableAmount" = "amount";

-- TODO(Task 4): remove this compatibility trigger and the schema defaults once all
-- application and seed writers persist an explicit allocation snapshot.
CREATE FUNCTION invoice_fill_legacy_allocation() RETURNS trigger AS $$
BEGIN
  IF NEW."amount" > 0
     AND NEW."rentAmount" = 0
     AND NEW."discountAmount" = 0
     AND NEW."applicationFeeAmount" = 0
     AND NEW."ownerReceivableAmount" = 0 THEN
    NEW."rentAmount" := NEW."amount";
    NEW."ownerReceivableAmount" := NEW."amount";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_fill_legacy_allocation_before_insert
BEFORE INSERT ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION invoice_fill_legacy_allocation();

ALTER TABLE "Invoice"
  ADD CONSTRAINT invoice_rent_amount_nonneg CHECK ("rentAmount" >= 0),
  ADD CONSTRAINT invoice_discount_amount_nonneg CHECK ("discountAmount" >= 0),
  ADD CONSTRAINT invoice_application_fee_amount_nonneg CHECK ("applicationFeeAmount" >= 0),
  ADD CONSTRAINT invoice_owner_receivable_amount_nonneg CHECK ("ownerReceivableAmount" >= 0),
  ADD CONSTRAINT invoice_discount_not_above_rent CHECK ("discountAmount" <= "rentAmount"),
  ADD CONSTRAINT invoice_owner_receivable_matches_rent CHECK ("ownerReceivableAmount" = "rentAmount" - "discountAmount"),
  ADD CONSTRAINT invoice_total_matches_allocation CHECK ("amount" = "ownerReceivableAmount" + "applicationFeeAmount");

ALTER TABLE "OwnerProfile"
  ADD COLUMN "xenditSubaccountId" TEXT,
  ADD COLUMN "xenditOnboardingStatus" "XenditOnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "xenditVerifiedAt" TIMESTAMPTZ(3);

ALTER TABLE "Payment"
  ADD COLUMN "providerBusinessId" TEXT,
  ADD COLUMN "providerSessionId" TEXT,
  ADD COLUMN "providerPaymentRequestId" TEXT,
  ADD COLUMN "providerPaymentId" TEXT,
  ADD COLUMN "providerSplitRuleId" TEXT,
  ADD COLUMN "checkoutUrl" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "channel" TEXT,
  ADD COLUMN "failureCode" TEXT,
  ADD COLUMN "manualMethod" "ManualPaymentMethod",
  ADD COLUMN "manualReference" TEXT,
  ADD COLUMN "manualNote" TEXT,
  ADD COLUMN "recordedById" TEXT,
  ADD COLUMN "refundedAt" TIMESTAMPTZ(3),
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3);

UPDATE "Payment" SET "updatedAt" = "createdAt";
ALTER TABLE "Payment" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE TABLE "PaymentWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "externalResourceId" TEXT NOT NULL,
  "paymentId" TEXT,
  "result" "PaymentWebhookResult" NOT NULL DEFAULT 'RECEIVED',
  "reason" TEXT,
  "metadata" JSONB,
  "processedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentRefund" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "providerRefundId" TEXT,
  "status" "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "submittedAt" TIMESTAMPTZ(3),
  "succeededAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_refund_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "payment_refund_attempts_nonneg" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "OwnerProfile_xenditSubaccountId_key" ON "OwnerProfile"("xenditSubaccountId");

CREATE UNIQUE INDEX "Payment_providerSessionId_key" ON "Payment"("providerSessionId");
CREATE UNIQUE INDEX "Payment_providerPaymentRequestId_key" ON "Payment"("providerPaymentRequestId");
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");
CREATE INDEX "Payment_recordedById_idx" ON "Payment"("recordedById");

CREATE UNIQUE INDEX "PaymentWebhookEvent_fingerprint_key" ON "PaymentWebhookEvent"("fingerprint");
CREATE INDEX "PaymentWebhookEvent_provider_externalResourceId_idx" ON "PaymentWebhookEvent"("provider", "externalResourceId");
CREATE INDEX "PaymentWebhookEvent_paymentId_idx" ON "PaymentWebhookEvent"("paymentId");
CREATE INDEX "PaymentWebhookEvent_result_createdAt_idx" ON "PaymentWebhookEvent"("result", "createdAt");

CREATE UNIQUE INDEX "PaymentRefund_paymentId_key" ON "PaymentRefund"("paymentId");
CREATE UNIQUE INDEX "PaymentRefund_referenceId_key" ON "PaymentRefund"("referenceId");
CREATE UNIQUE INDEX "PaymentRefund_providerRefundId_key" ON "PaymentRefund"("providerRefundId");
CREATE INDEX "PaymentRefund_status_nextAttemptAt_idx" ON "PaymentRefund"("status", "nextAttemptAt");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentWebhookEvent"
  ADD CONSTRAINT "PaymentWebhookEvent_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentRefund"
  ADD CONSTRAINT "PaymentRefund_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot represent this partial index without the preview feature (see ADR 0004).
-- An invoice may have history, but never two online checkout attempts that can still complete.
CREATE UNIQUE INDEX payment_one_live_online_attempt_per_invoice
ON "Payment"("invoiceId")
WHERE provider IN ('MOCK', 'XENDIT') AND status IN ('CREATING', 'PENDING');
