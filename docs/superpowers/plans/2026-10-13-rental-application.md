# Rental Application and Owner Approval Implementation Plan

**Goal:** Replace instant renter booking with an owner-reviewed rental application while reusing the existing timed payment hold after approval.

**Architecture:** Add a standalone `RentalApplication` aggregate and tRPC router. Submission creates no tenancy or payment. Owner approval atomically creates the existing pending tenancy, first invoice, and mock payment, then closes competing applications for that room. Existing room, payment, and tenancy rules remain authoritative.

**Tech Stack:** Prisma/PostgreSQL, Hono/tRPC, Zod, React 19, TanStack Query, Vitest, Playwright.

---

## Task 1: Add the application contract and persistence

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20261013090000_rental_application/migration.sql`
- Modify: `packages/shared/src/schemas.ts`
- Create: `backend/tests/integration/application.test.ts`

1. Add failing integration tests for anonymous submission, valid submission, duplicate pending submission, invalid date, and visibility isolation.
2. Add `RentalApplicationStatus` and `RentalApplication` with user, room, optional tenancy, decision timestamps, and indexes.
3. Add a partial unique index for one pending application per user and room.
4. Add Zod inputs for create and owner decision.
5. Generate Prisma Client.
6. Run the focused integration test and confirm expected failures now point to the missing router.

## Task 2: Implement renter application APIs

**Files:**

- Create: `backend/src/trpc/application.ts`
- Modify: `backend/src/trpc/router.ts`
- Modify: `backend/tests/integration/application.test.ts`

1. Implement `application.create` with the existing WIB date limits and live-room availability checks.
2. Implement `application.mine` returning status, renter-entered details, room/kos summary, and linked tenancy ID.
3. Translate partial-index races into a concise Indonesian conflict error.
4. Run `npm test -w backend -- application.test.ts`.

## Task 3: Implement owner review and atomic approval

**Files:**

- Modify: `backend/src/trpc/application.ts`
- Modify: `backend/src/trpc/booking.ts`
- Modify: `backend/src/trpc/router.ts`
- Modify: `backend/tests/integration/application.test.ts`

1. Add failing tests for owner list authorization, rejection, approval, stale decisions, and two approvals racing for one room.
2. Extract the existing pending-tenancy, invoice, and mock-payment creation into an internal transaction helper.
3. Implement `application.ownerList` through `ownerProcedure`.
4. Implement `application.decide`; approval uses the helper, links the tenancy, and rejects competing pending applications. Rejection creates no tenancy.
5. Keep `booking.mine` and payment simulation unchanged for approved renters.
6. Run focused application and booking integration tests.

## Task 4: Replace checkout with the application form

**Files:**

- Modify: `frontend/src/pages/Checkout.tsx`
- Modify: `e2e/tests/booking.spec.ts`

1. Replace payment-method state with occupation and optional-note state.
2. Keep room summary and server-priced first-payment estimate, clearly labeled as payable only after approval.
3. Submit through `application.create` with `Kirim Pengajuan` as the single primary action.
4. Add accessible loading, conflict, and success states. Success links to `Kos Saya`.
5. Remove pre-approval claims about holds, bank verification, and completed booking.
6. Update the focused renter E2E flow.

## Task 5: Show application status to renters

**Files:**

- Modify: `frontend/src/pages/MyKos.tsx`
- Modify: `frontend/src/lib/booking.ts`

1. Query `application.mine` beside tenancies.
2. Add a compact `Pengajuan Sewa` section with pending, approved, rejected, and withdrawn status text.
3. Keep approved payment actions in the existing tenancy card to avoid duplicate payment UI.
4. Include pending applications in the authenticated navbar count only if the label remains semantically accurate; otherwise leave the count tenancy-only.
5. Verify empty, loading, and error states at 390 px and desktop widths.

## Task 6: Add the owner decision panel

**Files:**

- Create: `frontend/src/components/owner/ApplicationsPanel.tsx`
- Modify: `frontend/src/pages/owner/Dashboard.tsx`
- Modify: `frontend/src/styles/components.css`
- Modify: `e2e/tests/owner.spec.ts`

1. Query pending applications for the selected kos.
2. Render actionable applications above the room board; place the empty state below it.
3. Show applicant, room, date, duration, occupation, campus, and note.
4. Add confirmed accept/reject actions, disable both during mutation, and invalidate application, board, kos-detail, and tenancy queries.
5. Use existing tokens and 40 px controls; stack actions on narrow screens.
6. Update the focused owner E2E flow.

## Task 7: Correct touched trust copy and verify

**Files:**

- Modify only touched detail/profile copy if it claims unimplemented verification.
- Modify: `CONTEXT.md`

1. Make verified-owner labels conditional where encountered in the changed flow.
2. Document the new application state and remaining direct-payment gap in `CONTEXT.md`.
3. Run `npm run typecheck`.
4. Run `npm test`.
5. Run `npm run build` and `npm run bundle:check`.
6. Run `npm run db:diff -w backend`.
7. Run focused Playwright booking and owner specs when PostgreSQL is available.

## Self-review

- Scope stays on the smallest coherent interview-driven release.
- No new dependency or design system.
- Application data is not mislabeled as tenancy data.
- Approval remains race-safe through the existing live-tenancy constraint.
- Payment and identity verification are not falsely presented as delivered.
- The only intentional compatibility break is replacing the public instant-booking entry point with application submission.
