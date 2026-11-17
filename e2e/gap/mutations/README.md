# Mutation probes

Each probe injects one fault; a probe is **killed** when at least one gap test fails. `node e2e/gap/mutations/run.mjs all` runs all 21 and writes `notes/gap-tests/mutation-results.all.csv`. The nightly/manual workflow `.github/workflows/mutation-probes.yml` requires 21 of 21 killed.

Needs `TEST_DATABASE_URL` and `E2E_DATABASE_URL` (see `CONTEXT.md`), and a built SPA (`npm run build`) for the e2e probes.

If a product change alters a behaviour a probe targets, update the probe (`faults.ts` / `backend-faults.setup.ts`), never the test.

## E2E probes (browser-side faults, `faults.ts`)

| id | fault | what it guards |
|----|-------|----------------|
| F01 | kos.search returns an empty list | /search shows an error with a retry, not a blank page (G-045) |
| F02 | kos.search answers 8 s late | the loading state appears first (G-048) |
| F03 | booking.mine adds Rp 1.000 to every invoice | "Perlu tindakan" counts and amounts are exact (G-050) |
| F04 | booking.mine returns an empty list | same (G-050) |
| F05 | application.ownerList drops the first application | owner dashboard counts (G-050) |
| F06 | owner.visits returns an empty list | owner dashboard counts (G-050) |
| F07 | kos.detail adds Rp 1.000 to every room price | an owner never sees another owner's kos (G-051) |
| F08 | owner.myKos returns an empty list | owner dashboard counts (G-050) |
| F09 | owner.board answers 403 | every control on key routes has an accessible name (G-053) |
| F10 | auth.me answers signed out | modal focus/Escape and counts (G-054, G-050) |
| F11 | every aria-label removed | accessible names (G-053) |
| F12 | Escape swallowed | modal closes with Escape (G-054) |
| F13 | kos.search lists every card twice | loading-then-list sequence (G-048) |
| F14 | owner.visits answers 500 | accessible controls and error states (G-053) |
| F15 | two room numbers swapped in owner.myKos | empty-state and list correctness (G-047) |

## Backend probes (`backend-faults.setup.ts`)

| id | fault | what it guards |
|----|-------|----------------|
| B01 | application.decide skips the owner check | another owner is refused (authz) |
| B02 | kos.detail reports every room vacant | booking hold flips a room to booked |
| B03 | owner.board never reports overdue | overdue boundary at 23:59:59 WIB |
| B04 | kuitansi.get prints month 01 for every receipt | receipt number format |
| B05 | auth.setNotifyOptOut does nothing | opt-out requires and persists |
| B06 | application.create swallows BAD_REQUEST | bounds on application input |
