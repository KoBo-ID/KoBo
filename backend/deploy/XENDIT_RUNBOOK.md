# Xendit Test Mode runbook

Scope: Test Mode only. Live money is blocked until the Stage B gate in `docs/superpowers/plans/2026-10-13-xendit-payment-integration.md` is signed off. Design: ADR 0015.

## 1. Setup

1. In the Xendit dashboard (Test Mode) create a secret API key with the minimum permissions for Payment Sessions and Refunds. It starts with `xnd_development_`.
2. Settings, Webhooks: set the URL for payment sessions and refunds to `https://<domain>/api/webhooks/xendit` and copy the **webhook verification token**.
3. Set on the server (never commit): `PAYMENT_PROVIDER=xendit`, `XENDIT_MODE=test`, `XENDIT_SECRET_API_KEY`, `XENDIT_CALLBACK_TOKEN`, `XENDIT_BUSINESS_ID`. Optional `PAYMENT_RETURN_ORIGIN` when the public origin differs from `BETTER_AUTH_URL` (must be https for Xendit).
4. Restart. The server refuses to start if a key does not match the mode prefix, or if `XENDIT_MODE=live` lacks `ENABLE_XENDIT_LIVE=1`.

Demo accounts always use the in-app MOCK provider, whatever `PAYMENT_PROVIDER` says.

## 2. Test Mode smoke test

Approved application, then `Bayar Sekarang`, then pay on the hosted page with a Test Mode method (use the dashboard simulator or a test channel), then confirm: callback accepted (`PaymentWebhookEvent` row `APPLIED`), tenancy ACTIVE, owner board "Pembayaran terverifikasi", receipt at `/kuitansi/<n>`, two `payment-received*` outbox rows. Record IDs and timestamps in the deployment checklist, not keys or personal data.

## 3. Behaviour to know

- An attempt lives at most 30 minutes and never past the tenancy hold; Xendit needs at least 11 minutes, so a hold under that gives "Sisa waktu pembayaran terlalu singkat".
- A `CREATING` row older than 2 minutes is failed (`STALE_CREATING`). If money later arrives for it, settlement still honours it or refunds it.
- `Periksa Status` (reconcile) is throttled to one provider lookup per attempt per 30 seconds.
- A background sweep (every 5 min) asks Xendit about attempts still open after 10 minutes, and about attempts that closed in the last 24 h, so a payment whose callbacks were lost is credited or refunded without anyone clicking. Callbacks it cannot verify (missing amount or payment ids) are audited as `REJECTED` and left to the sweep.
- A payment that completed before the hold ended is honoured even if its callback is processed a little later, unless the room was offered to someone else; otherwise it is refunded.
- Refund worker: every 15 s, lease 120 s, 8 attempts with 1, 2, 4... minute backoff capped at 6 h.

## 4. Rotating keys

Callback token: create the new token in the dashboard, update `XENDIT_CALLBACK_TOKEN`, restart, then confirm the next event is accepted (401 means the token is wrong). API key: create a new key, swap `XENDIT_SECRET_API_KEY`, restart, revoke the old key. Events sent during the restart are retried by Xendit.

## 5. Monitoring queries (read only)

```sql
-- Attempts stuck creating for over 5 minutes (should be 0; the next start or reconcile reaps them)
SELECT id, "invoiceId", "createdAt" FROM "Payment" WHERE status = 'CREATING' AND "createdAt" < now() - interval '5 minutes';

-- Callbacks that were authentic but not applied
SELECT result, reason, "eventType", count(*) FROM "PaymentWebhookEvent" WHERE result IN ('IGNORED','REJECTED','FAILED') GROUP BY 1,2,3 ORDER BY 4 DESC;

-- Money waiting to go back, and refunds needing a human
SELECT p.status, r.status AS refund_status, count(*) FROM "Payment" p JOIN "PaymentRefund" r ON r."paymentId" = p.id
WHERE p.status IN ('REFUND_PENDING','REFUND_FAILED') GROUP BY 1,2;
SELECT r.id, r."referenceId", r.attempts, r."lastError", r."updatedAt" FROM "PaymentRefund" r WHERE r.status IN ('FAILED') OR (r.status = 'SUBMITTED' AND r."submittedAt" < now() - interval '1 day');

-- More than one paid attempt on an invoice (must be 0)
SELECT "invoiceId", count(*) FROM "Payment" WHERE status = 'PAID' GROUP BY 1 HAVING count(*) > 1;
```

## 6. Refund intervention

`npm run refunds:admin -w backend -- list` shows refunds that automation cannot finish: `FAILED` ones (with `lastError`, e.g. `INSUFFICIENT_BALANCE`) and ones `SUBMITTED` for over a day with no callback.

- **Submitted, no callback:** look the refund up in the Xendit dashboard by its `referenceId` (`refund_<paymentId>`). If it shows the final outcome, record it: `refunds:admin -- resolve <refundId> succeeded|failed`.
- **Failed:** fix the cause (top up balance, correct the channel). Then confirm in the dashboard that **no refund exists** for that payment and run `refunds:admin -- requeue <refundId> --confirm-not-refunded`. It re-queues under a fresh reference id (the old one may replay the old failure) and refuses without the flag. Never requeue when the dashboard shows a refund, or the tenant is refunded twice.
- Do not edit money rows by hand.

## 7. Rollback (non-live environments only)

Set `PAYMENT_PROVIDER=mock` (production also needs `ALLOW_MOCK_PAYMENTS=1`, which is a test/e2e opt-in) and restart. In-flight Xendit attempts are not cancelled: their callbacks return 404 until the provider is switched back, and Xendit retries them. Do this only when no live attempts are expected.
