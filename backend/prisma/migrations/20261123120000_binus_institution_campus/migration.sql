-- Represent BINUS University as a single institution record for student verification (not per-location branches).
INSERT INTO "Campus" ("id", "name", "shortName", "city", "lat", "lng", "emailDomains", "studentEmailDomains", "entraTenantIds", "kind", "aliases")
VALUES (
  'binus',
  'BINUS University',
  'BINUS University',
  '',
  -6.2001,
  106.7852,
  ARRAY['binus.ac.id'],
  ARRAY['binus.ac.id'],
  ARRAY['3485b963-82ba-4a6f-810f-b5cc226ff898'],
  'institution',
  ARRAY['binus', 'bina nusantara', 'universitas bina nusantara', 'binus university']
)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "shortName" = EXCLUDED."shortName",
  "city" = EXCLUDED."city",
  "kind" = EXCLUDED."kind",
  "emailDomains" = EXCLUDED."emailDomains",
  "studentEmailDomains" = EXCLUDED."studentEmailDomains",
  "entraTenantIds" = EXCLUDED."entraTenantIds",
  "aliases" = EXCLUDED."aliases";

UPDATE "Campus"
SET "parentId" = 'binus'
WHERE "id" <> 'binus'
  AND ("id" LIKE 'binus-%' OR lower("name") LIKE '%binus%' OR lower("name") LIKE '%bina nusantara%');

UPDATE "User"
SET "verifiedCampusId" = 'binus',
    "campus" = CASE WHEN "campus" IS NULL OR lower("campus") LIKE 'binus%' THEN 'BINUS University' ELSE "campus" END
WHERE "verifiedCampusId" LIKE 'binus-%';
