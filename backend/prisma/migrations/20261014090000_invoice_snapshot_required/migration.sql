-- Every invoice writer now persists the immutable allocation snapshot explicitly.
-- Remove the temporary Task 1 compatibility behavior so omissions fail fast.
DROP TRIGGER IF EXISTS invoice_fill_legacy_allocation_before_insert ON "Invoice";
DROP FUNCTION IF EXISTS invoice_fill_legacy_allocation();

ALTER TABLE "Invoice"
  ALTER COLUMN "rentAmount" DROP DEFAULT,
  ALTER COLUMN "discountAmount" DROP DEFAULT,
  ALTER COLUMN "applicationFeeAmount" DROP DEFAULT,
  ALTER COLUMN "ownerReceivableAmount" DROP DEFAULT,
  ALTER COLUMN "gatewayFeeBearer" DROP DEFAULT;
