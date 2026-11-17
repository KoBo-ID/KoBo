# Tier 1 location catalogue (Jabodetabek + Bandung places, nationwide regions, campuses)

Built by the data job (`notes/data-gathering/scripts`, git-excluded), loaded by `npm run catalog:import -w backend -- all data/catalog`
(see `backend/deploy/RUNBOOK.md` section 12). File names are `<dataset>.<data_version>.csv.gz`; every file carries exactly one `data_version`.

| File | Source | Licence | Credit |
|---|---|---|---|
| `region.*` | cahyadsn/wilayah (codes), cahyadsn/wilayah_boundaries (centroids, simplified polygons) | MIT | github.com/cahyadsn. Polygon provenance unconfirmed. |
| `campus.*` | KoBo's own 98-branch catalogue + OpenStreetMap | KoBo-original / ODbL 1.0 | © OpenStreetMap contributors (925 rows, flagged `derivedFromOsm`) |
| `places-tier1.osm-*` | OpenStreetMap via Geofabrik | ODbL 1.0 | © OpenStreetMap contributors |
| `places-tier1.overture-*` | Overture Maps Places, release 2026-10-21.0 | CDLA-Permissive-2.0 (Meta, Microsoft, Uberall, PinMeTo, DAC), Apache-2.0 (Foursquare), CC0-1.0 (AllThePlaces), per row | Overture Maps Foundation; Foursquare rows: "Copyright 2024 Foursquare Labs, Inc." and the Apache-2.0 NOTICE |

Rows from different sources are never merged. Phones, emails and other contact data were never read. Licence texts belong on `/lisensi`.
