-- kos_area_stats: how many places of each category sit in a kos snapshot (shown, not hidden). A selling point for owners and the
-- "nothing here yet - add it" prompt when a category has none. A plain view, no data of its own.
--
-- Down:  DROP VIEW kos_area_stats;

CREATE VIEW kos_area_stats AS
SELECT "kosId", category, (count(*) FILTER (WHERE NOT "hiddenByOwner"))::int AS places, min("distanceM") FILTER (WHERE NOT "hiddenByOwner") AS "nearestM"
FROM "KosPlace"
GROUP BY "kosId", category;
