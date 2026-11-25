-- CreateEnum
CREATE TYPE "ApplicationDecisionReason" AS ENUM ('KAMAR_TIDAK_TERSEDIA', 'MEMILIH_PENGAJU_LAIN', 'TANGGAL_TIDAK_COCOK', 'LAINNYA');

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'WAIVED';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "waivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "waivedById" TEXT,
ADD COLUMN     "waiverReason" TEXT;

-- AlterTable
ALTER TABLE "RentalApplication" ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "decisionReason" "ApplicationDecisionReason";
