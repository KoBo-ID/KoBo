# 0009. Email outbox table instead of a job queue

**Context.** Only a few emails exist (verification, reset, campus email, payment received). A queue such as pg-boss adds a dependency and operational surface for two jobs.

**Decision.** Write an `EmailOutbox` row inside the business transaction and drain it every 15 seconds. Rows are claimed with `UPDATE ... FOR UPDATE SKIP LOCKED` so two overlapping containers (for example during a rollback) cannot double-send; retries use `attempts` and `nextAttemptAt`. Tests call `drainOutbox()` directly.

**Consequences.** Emails survive crashes and never describe a transaction that rolled back. Delivery latency is up to 15 s. Resend's free tier caps volume, and demo logins send no email.
