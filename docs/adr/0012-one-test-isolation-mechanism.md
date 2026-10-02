# 0012. One isolation mechanism for tests: resetDb

**Context.** Per-test rollback, truncate-and-reseed and snapshot restore are three mechanisms to maintain, and rollback hides commit behaviour, better-auth's global client and concurrency.

**Decision.** Every integration test starts with `resetDb()` (truncate and a deterministic seed) against a real Postgres, with `fileParallelism: false`. Domain logic is test-first with fast-check properties and an injected `today`. Two E2E money flows plus a route smoke suite run on the production build; no pixel snapshots or hard-coded counts.

**Consequences.** Tests behave like production and double as the demo seed. The suite is a little slower than rollback-based isolation. The same truncate-and-seed idea backs the demo reset, which is scoped to demo-owned rows only (ADR 0013).
