# 0008. Payment provider port, HMAC webhook, server-side simulator

> **Superseded by [0015](0015-xendit-hosted-checkout.md).** The provider port and the MOCK adapter remain (demo users and tests); the HMAC route and payment-at-approval were replaced.

**Context.** There is no real payment gateway in scope, yet the money flow must be real enough to test and demo: idempotent crediting, activation, invoices and receipts.

**Decision.** A `PaymentProvider` port with a mock implementation. Confirmation arrives at `POST /api/webhooks/payment`, verified by HMAC over the raw body and idempotent on a unique `externalId`; activation, all invoices and the outbox email row are written in one transaction. "Simulasikan Pembayaran" is a server procedure that signs only the caller's own pending payment. Owners record cash or transfer as `MANUAL` payments.

**Consequences.** A webhook delivered twice credits once, and nobody can mark another user's payment paid. Swapping in a real gateway means writing one provider. Kuitansi is an HTML page with print CSS, not a stored PDF.

**Update (2026-10-14).** The HMAC route was replaced by `POST /api/webhooks/xendit`, authenticated with Xendit's `x-callback-token` and audited in `PaymentWebhookEvent`; the simulator is demo-only and feeds the same provider-neutral settlement. A new ADR will supersede this one (plan Task 13).
