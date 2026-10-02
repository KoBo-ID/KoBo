# 0002. tRPC with httpLink (no batching) and TanStack Query

**Context.** The API is consumed by one SPA written in the same repo. A REST layer would duplicate types. Batching bundles unrelated calls into one request and complicates caching, error handling and `cache-control` per procedure.

**Decision.** tRPC v11 with `httpLink` and TanStack Query on the client. Server-side `createCaller` backs the integration tests. Known domain errors are explicit `TRPCError` codes with Indonesian messages; validation and unknown errors collapse to one generic message.

**Consequences.** End-to-end types for free and tests that skip HTTP. The cost is a query-key convention to keep consistent and about 17 KB gzip of client code. Auth-dependent answers are served with `no-store`.
