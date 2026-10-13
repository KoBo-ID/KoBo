# Rental Application and Owner Approval Design

## Problem

KoBo currently creates a 24-hour room hold and payment immediately. Interviews show that owners need to screen renters first, while renters distrust platform-first payment. The current flow presents owner approval as if it does not exist.

## Scope

This release replaces instant self-booking with a rental application and owner decision. It keeps the existing demo payment system after approval so the change remains one coherent vertical slice.

Included:

- renter application with move-in date, duration, occupation, and optional note;
- renter application status history;
- owner pending-application queue per kos;
- approve or reject actions;
- approval creates the existing 24-hour payment hold, invoice, and mock payment;
- truthful application and verification copy on touched screens.

Deferred:

- direct bank transfer details and proof upload;
- deposit ledger;
- identity-verification workflow;
- owner-editable rules and minimum stay;
- reminders and appliance records.

## Approaches Considered

### 1. Add application fields to `Tenancy`

Small schema change, but rejected applicants become fake tenancies and room-status logic gains exceptions. Rejected.

### 2. Add `RentalApplication`

Applications remain separate from residents. Approval creates the current tenancy atomically. Chosen.

### 3. Extend `WaitlistEntry`

Reuses an existing queue, but FIFO room offers and owner-selected applications have different rules. Rejected.

## Domain Model

`RentalApplication` belongs to one user and one room.

- `status`: `PENDING`, `APPROVED`, `REJECTED`, or `WITHDRAWN`;
- `startDate` and `durationMonths` capture the proposed stay;
- `occupation` answers the owner's screening need;
- `note` is optional context;
- `decidedAt` records the decision;
- `tenancyId` links an approved application to the created tenancy.

One user may have only one pending application for the same room. Several users may apply to a room. Once one application is approved, other pending applications for that room are rejected.

## Server Flow

### Submit

1. Authenticate the renter.
2. Validate room, date, duration, and availability.
3. Reject a duplicate pending application by the same renter.
4. Create a pending application. Do not create an invoice, payment, or room hold.

### Decide

1. Authorize the owner through `kosId`.
2. Lock the decision inside a transaction.
3. On rejection, update only the application.
4. On approval, verify the room is still bookable, create the current 24-hour pending tenancy, invoice, and mock payment, then link the application.
5. Reject remaining pending applications for that room.
6. Let the existing unique live-tenancy constraint settle approval races.

## Renter UI

The checkout route becomes `Pengajuan Sewa`.

- Keep the selected room summary.
- Collect move-in date, duration, occupation, and optional note.
- Remove payment method selection and price-payment promises before approval.
- Primary action: `Kirim Pengajuan`.
- Success state explains that the owner must respond before payment.
- `Kos Saya` shows applications above active rentals with explicit pending, approved, rejected, and withdrawn labels.
- An approved application points to the existing payment action created by the tenancy.

## Owner UI

The dashboard shows pending applications above the occupancy board when action is required.

Each row shows renter name, room, proposed move-in date, duration, occupation, campus when present, and note. Actions are `Terima` and `Tolak`. Decisions require a native confirmation because approval creates a timed hold.

## Visual Design

- Use existing cards, buttons, badges, notices, tokens, and container widths.
- Application status uses text plus semantic color.
- No new animation or dependency.
- Pending applications are a compact list, not KPI cards.
- Mobile rows stack content above full-width actions.

## Error and Edge States

- room no longer available at approval;
- duplicate pending application;
- application already decided;
- owner does not own the kos;
- stale dashboard decision;
- loading, empty, and query-error states for both renter and owner lists.

## Verification

- Integration tests cover submit, duplicate rejection, authorization, approve, reject, competing approval, and renter/owner visibility.
- Existing booking, payment, waitlist, and room-status tests remain green after adapting the public entry point.
- Typecheck, shared/backend tests, build, bundle gate, database drift, and focused Playwright flow.
