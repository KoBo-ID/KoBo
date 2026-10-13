-- Data-only: the seeded Unsplash photo for kos-2 started returning 404. Swap it for a live one.
-- Seed photos are stored only in "KosImage"."url" (owner/review avatars were all still 200).
UPDATE "KosImage"
SET "url" = 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800&auto=format&fit=crop&q=80'
WHERE "url" = 'https://images.unsplash.com/photo-1540518614846-7ede433c4550?w=800&auto=format&fit=crop&q=80';
