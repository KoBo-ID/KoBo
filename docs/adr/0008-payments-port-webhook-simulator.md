# 0008. Payment provider port, HMAC webhook, server-side simulator

**Context.** There is no real payment gateway in scope, yet the money flow must be real enough to test and demo: idempotent crediting, activation, invoices and receipts.

**Decision.** A `PaymentProvider` port with a mock implementation. Confirmation arrives at `POST /api/webhooks/payment`, verified by HMAC over the raw body and idempotent on a unique `externalId`; activation, all invoices and the outbox email row are written in one transaction. "Simulasikan Pembayaran" is a server procedure that signs only the caller's own pending payment. Owners record cash or transfer as `MANUAL` payments.

**Consequences.** A webhook delivered twice credits once, and nobody can mark another user's payment paid. Swapping in a real gateway means writing one provider. Kuitansi is an HTML page with print CSS, not a stored PDF.
