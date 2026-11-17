-- Hand-written. Prisma cannot express these (and the `partialIndexes` preview stays OFF on purpose:
-- Postgres rewrites the enum IN-list into a form that triggers Prisma's regeneration loop, #29386).

-- Makes double-booking physically impossible: at most one live tenancy per room.
CREATE UNIQUE INDEX tenancy_one_active_per_room ON "Tenancy"("roomId") WHERE status IN ('PENDING', 'ACTIVE');

-- Money is integer rupiah, never negative.
ALTER TABLE "Kos" ADD CONSTRAINT kos_student_discount_nonneg CHECK ("studentDiscountAmount" >= 0);
ALTER TABLE "Kos" ADD CONSTRAINT kos_application_fee_nonneg CHECK ("applicationFee" >= 0);
ALTER TABLE "Room" ADD CONSTRAINT room_price_nonneg CHECK ("priceMonthly" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT invoice_amount_nonneg CHECK ("amount" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT payment_amount_nonneg CHECK ("amount" >= 0);
ALTER TABLE "HouseRule" ADD CONSTRAINT houserule_penalty_nonneg CHECK ("penaltyAmount" IS NULL OR "penaltyAmount" >= 0);

-- Ratings are 1..5 (sub-ratings optional).
ALTER TABLE "Review" ADD CONSTRAINT review_rating_range CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "Review" ADD CONSTRAINT review_cleanliness_range CHECK ("cleanliness" IS NULL OR "cleanliness" BETWEEN 1 AND 5);
ALTER TABLE "Review" ADD CONSTRAINT review_wifi_range CHECK ("wifi" IS NULL OR "wifi" BETWEEN 1 AND 5);
ALTER TABLE "Review" ADD CONSTRAINT review_owner_range CHECK ("ownerRating" IS NULL OR "ownerRating" BETWEEN 1 AND 5);
ALTER TABLE "Review" ADD CONSTRAINT review_quietness_range CHECK ("quietness" IS NULL OR "quietness" BETWEEN 1 AND 5);

-- A lease runs for at least one month.
ALTER TABLE "Tenancy" ADD CONSTRAINT tenancy_duration_positive CHECK ("durationMonths" > 0);

-- A photo is either an uploaded object (key) or a seeded external url.
ALTER TABLE "KosImage" ADD CONSTRAINT kosimage_key_or_url CHECK ("key" IS NOT NULL OR "url" IS NOT NULL);
