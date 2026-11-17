# 0005. Derive status and aggregates on read

**Context.** Room status (`paid`, `due`, `overdue`, `vacant`, `booking`), ratings, minimum price and room counts could be cached columns kept in sync by recompute jobs. At a few hundred kos, search runs in under 5 ms.

**Decision.** Nothing is cached. `deriveRoomStatus` is a pure function of occupancy, tenancy, oldest unpaid invoice and an injected `today` (WIB). Aggregates are joined into the search query. A `PENDING` tenancy past `expiresAt` reads as vacant, so an abandoned checkout never shows "Booking" forever and no cleanup job exists.

**Consequences.** Results are correct by construction with no invariants to test. If data grows by orders of magnitude, add pagination or materialised views then. Time logic lives in one `todayWIB()` helper, which also avoids the date-versus-timestamp trap.
