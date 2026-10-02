# 0006. better-auth, session-derived persona, demo logins

**Context.** Rolling our own auth costs 15-20 hours more. The old prototype stored persona in client state and trusted `?role=owner`. Reviewers will not register or open an inbox.

**Decision.** better-auth with email and password, pinned to a patched release, its rate limiter configured in code (extra limits on email-sending endpoints) and the client address read only from `cf-connecting-ip`. Persona is derived from the session: owner means an `OwnerProfile` exists, and every owner write goes through `ownerProcedure` (the `kosId` must belong to the caller). One-click demo logins use seeded accounts that cannot change email or password or delete data.

**Consequences.** Cross-owner writes are rejected by one tested guard. The limiter is stricter than a dashboard rule and lives in the repo. The origin must be reachable only through the tunnel for the IP header to be trusted.
