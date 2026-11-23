-- Kampus Mitra is per institution, not per campus location: BINUS branches point at the 'binus' parent and the
-- affiliation row is the institution. Any student verified at a BINUS branch counts.
UPDATE "Campus" SET "parentId" = 'binus' WHERE "id" IN ('binus-syahdan', 'binus-anggrek', 'binus-kijang');

INSERT INTO "CampusAffiliation" ("id", "campusId", "label", "active", "createdAt")
VALUES ('binus-institution-mitra', 'binus', 'BINUS University', true, now())
ON CONFLICT ("campusId") DO UPDATE SET "label" = EXCLUDED."label", "active" = true;

-- The per-branch rows are replaced by the institution row above.
UPDATE "CampusAffiliation" SET "active" = false WHERE "campusId" IN ('binus-syahdan', 'binus-anggrek', 'binus-kijang');
