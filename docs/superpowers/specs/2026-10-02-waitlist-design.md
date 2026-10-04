# Daftar Tunggu (waiting list with queue numbers): design

Status: approved by the main dev on 2026-10-02. Implementation follows the plan at the end of this file.

## Why

Today a full kos is a dead end: a student who wants it can only refresh the page and hope to win the race when a hold lapses or a tenant moves out. Mamikos ("Ikut Daftar Tunggu", kos/room-type level, owner "Daftar Tunggu" page) and Rukita ("Join Waiting List" on sold-out room types) both capture this demand, but both only notify everyone, so the first to book wins and there is no meaningful position (`notes/research/mamikos/pages/detail-managed.md`, `notes/research/rukita/pages/detail.md`). KoBo goes one step further: a **FIFO queue with a visible number and an exclusive priority window**, so "Antrean #3" is a real promise.

## Rules

### Joining

- A signed-in user joins one kos's queue, either for one room type (`Room.type`, for example "Deluxe AC") or for any type (`roomType = null`).
- Joining is allowed only when the kos has **no bookable room matching the preference**. Bookable = derived status `vacant` and not reserved by a live offer to someone else. Otherwise the server answers `BAD_REQUEST` "Masih ada kamar kosong, silakan langsung pesan."
- A named `roomType` must exist among the kos's rooms (`BAD_REQUEST` otherwise).
- One live entry (`WAITING` or `OFFERED`) per user per kos (partial unique index; a second join is `CONFLICT` "Kamu sudah ada di daftar tunggu kos ini.").
- At most `MAX_LIVE_ENTRIES = 5` live entries per user across all kos (`BAD_REQUEST`).
- The owner of the kos cannot join their own kos's queue (`FORBIDDEN`).
- Having an ACTIVE tenancy elsewhere does not block joining.
- **Revised 2026-10-04:** a user with a live tenancy (ACTIVE, or an unexpired PENDING hold) in this kos cannot join its queue (`BAD_REQUEST` "Kamu sudah menyewa kamar di kos ini."). `waitlist.status` returns `rentingHere` so the UI hides the join button.
- **Revised 2026-10-04:** public reads (`waitlist.status`, `kos.detail` room flags) use `roomClaims()`, a read-only projection of what the next advance would do. A room a waiter would get counts as taken, so "full" and the room list never show a room that booking would refuse. Room create/update already advance the queue inline.
- **Revised 2026-10-04:** the background advance runs every 15 s (was 60 s), so a freed room is offered sooner. Queue-first is enforced at booking time: booking advances the queue before it checks the room, so a free room with a matching waiter is always offered to that waiter first.

### Queue number (computed on read, ADR 0005)

Two preferences **compete** when either is `null` (any type) or both are equal.

`position(entry) = 1 + count(other WAITING entries of the same kos with createdAt (then id) earlier than entry AND competing with entry)`

Only `WAITING` entries have a position. An `OFFERED` entry shows its offer instead. The number never goes up while waiting. Ordering ties break on `id`.

### Releasing a room (FIFO priority window)

An **offer** belongs to an entry: `status = OFFERED`, `offeredRoomId`, `offerExpiresAt = now + OFFER_HOURS` (`OFFER_HOURS = 24`, same as `HOLD_HOURS`).

`advanceWaitlist(tx, kosId, now)` runs for one kos inside a transaction that first locks the kos row (`SELECT ... FROM "Kos" WHERE id = $1 FOR UPDATE`) so concurrent runs serialise:

1. **Lapse:** `OFFERED` entries with `offerExpiresAt < now` become `EXPIRED`, `resolvedAt = now`.
2. **Find free rooms:** rooms of the kos whose derived status is `vacant` (no ACTIVE tenancy, no PENDING tenancy with `expiresAt >= now`) and that have no live offer (`OFFERED`, `offerExpiresAt >= now`). Order rooms by `roomNumber`.
3. **Match:** walk `WAITING` entries in queue order (`createdAt`, `id`). For each entry, take the first free room whose `type` matches (`entry.roomType === null || room.type === entry.roomType`). If one exists, the entry becomes `OFFERED` with that room and the room leaves the free set. Stop when no free rooms remain.
4. **Notify:** for each new offer, `enqueueEmail(tx, { template: 'waitlist-offer', to, payload: { name, kosName, roomNumber, expiresAt, url: origin + '/kos/' + <whatever param the /kos/:id route resolves> } })`.

Free rooms that match no waiting entry stay open to normal booking.

`advanceAllWaitlists(prisma, now)` finds kos ids with at least one live entry and runs `advanceWaitlist` for each in its own transaction.

**When it runs:**
- Every 60 s from an interval worker started in `index.ts` next to the outbox worker (never from `createApp`, so tests stay deterministic; tests call it directly).
- Inline, inside the same transaction, after `owner.tenancy.end`, `owner.room.create`, `owner.room.update` (type changes), `waitlist.decline`, `waitlist.leave` of an OFFERED entry, and `owner.waitlist.remove` of an OFFERED entry, so releases feel instant.

### Accepting, declining, lapsing

- **Accept = book.** `booking.create` for room R, inside its existing transaction and before inserting the tenancy:
  - Run the full `advanceWaitlist(tx, R.kosId, now)`, after the existing expiry of lapsed holds. Holds lapse lazily, so without this a stranger could book a just-freed room in the up-to-60 s gap before the next tick and jump the queue. Advancing first means the room is already offered to #1 when the guard below runs.
  - If R has a live offer to **another** user, reject with `CONFLICT` "Kamar ini sedang ditawarkan ke pengantre lain."
  - If R has a live offer to **this** user, mark that entry `FULFILLED`, `resolvedAt = now`.
  - If this user has a WAITING entry for the same kos and books any other bookable room (possible when a room opens to the public because nobody's preference matched it), mark that entry `FULFILLED` as well, so they don't keep a place in a queue they no longer need.
- **Decline:** `waitlist.decline({ entryId })` on the caller's OFFERED entry → `DECLINED`, then `advanceWaitlist` passes the room on.
- **Lapse:** an offer past `offerExpiresAt` → `EXPIRED` (lazily in the steps above). The student loses their place and may rejoin at the back.
- **Unpaid hold:** if the waitlist student books but the 24 h payment hold lapses, the room reads vacant again and the next tick offers it to the next entry. The FULFILLED entry is not revived.

### Leaving and owner removal

- `waitlist.leave({ entryId })`: caller's WAITING or OFFERED entry → `LEFT`. If it was OFFERED, advance.
- `owner.waitlist.remove({ kosId, entryId })`: owner-only (ownerProcedure), entry must belong to `kosId` → `REMOVED`. If it was OFFERED, advance. Owners cannot reorder.

### Interactions with existing features

- `owner.kos.delete` and `owner.room.delete`: also refused while a live offer exists on the kos or room ("Masih ada penawaran daftar tunggu aktif."). Otherwise entries cascade.
- `deriveRoomStatus` is unchanged. A room with a live offer is still `vacant` on the board, but the detail page and booking guard treat it as reserved. `kos.detail` room rows gain `reservedForWaitlist: boolean` (true when another user holds the live offer) and `offeredToMe: boolean`.
- Demo: `resetDemo()` deletes waitlist entries of demo users and entries on demo kos that belong to demo users (same scoping rule as tenancies). Demo users may join queues.
- Search, list cards and pricing are unchanged.

## Data model

```prisma
enum WaitlistStatus {
  WAITING
  OFFERED
  FULFILLED
  EXPIRED
  DECLINED
  LEFT
  REMOVED
}

model WaitlistEntry {
  id             String         @id @default(cuid(2))
  kosId          String
  kos            Kos            @relation(fields: [kosId], references: [id], onDelete: Cascade)
  userId         String
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// null = any room type
  roomType       String?
  status         WaitlistStatus @default(WAITING)
  offeredRoomId  String?
  offeredRoom    Room?          @relation(fields: [offeredRoomId], references: [id], onDelete: SetNull)
  offerExpiresAt DateTime?      @db.Timestamptz(3)
  createdAt      DateTime       @default(now()) @db.Timestamptz(3)
  resolvedAt     DateTime?      @db.Timestamptz(3)

  @@index([kosId, status, createdAt])
  @@index([userId])
}
```

Back-relations: `Kos.waitlist`, `User.waitlistEntries`, `Room.waitlistOffers`.

Hand-written migration SQL (partial indexes, ADR 0004):

```sql
CREATE UNIQUE INDEX waitlist_one_live_per_user_kos ON "WaitlistEntry"("userId", "kosId") WHERE status IN ('WAITING', 'OFFERED');
CREATE UNIQUE INDEX waitlist_one_offer_per_room ON "WaitlistEntry"("offeredRoomId") WHERE status = 'OFFERED';
```

`npm run db:diff -w backend` must print "No difference detected" afterwards.

## Shared package

- `@kobo/shared/domain/waitlist.ts` (pure, unit-tested): `competes(a, b)`, `queuePosition(entry, waiting[])`, `matchOffers(waitingInOrder, freeRooms)` → `{ entryId, roomId }[]`. The server's `advanceWaitlist` uses `matchOffers` so the matching rule lives in one place.
- `@kobo/shared/schemas`: `waitlistJoinInput { kosId, roomType: string | null }`, `waitlistEntryInput { entryId }`, `ownerWaitlistRemoveInput { kosId, entryId }`.
- `@kobo/shared/types`: `WaitlistStatus`.

## API (tRPC)

New `waitlist` router (`backend/src/trpc/waitlist.ts`), mounted in the app router:

| Procedure | Guard | Returns |
|---|---|---|
| `status({ kosId })` | public | `{ full: boolean, types: { roomType: string \| null, waiting: number }[], mine: MyWaitlistEntry \| null }`. `full` = no bookable room at all; `types` lists each distinct room type with how many WAITING entries compete for it. `mine` only when signed in. |
| `join({ kosId, roomType })` | authed | `MyWaitlistEntry` |
| `leave({ entryId })` | authed, own entry | `{ id }` |
| `decline({ entryId })` | authed, own OFFERED entry | `{ id }` |
| `mine()` | authed | `MyWaitlistEntry[]` (live entries first, then the last 10 resolved) |

`MyWaitlistEntry = { id, status, roomType, position: number | null, createdAt, kos: { id, slug, name, image }, offer: { roomId, roomNumber, priceMonthly, expiresAt } | null }`

Owner additions in `owner.ts`: `waitlist({ kosId })` query → `OwnerWaitlistEntry[]` in queue order (live first) `{ id, position, status, roomType, createdAt, user: { name, campus, image, campusVerified }, offer }`, and `waitlist.remove`. Name the nested router so it doesn't clash with the query (for example `waitlistEntries` query + `waitlist.remove`, following how `visits`/`visit` are split). `BoardSummary` gains `waitlistCount` (live entries).

All messages are Indonesian `TRPCError`s.

## Email

`emailTemplates.ts` gains `waitlist-offer`. Subject "Kamar di {kosName} tersedia untukmu". Body: room number, the deadline in WIB, and a button to the kos page. No email on join, lapse or removal.

## UI (Indonesian copy, existing tokens and classes, CONTEXT.md conventions)

- **`/kos/:id` sticky sidebar (`StickyBookingSidebar`) and mobile CTA:**
  - When `status.full` (or the selected type has no bookable room): show "Kamar Penuh", a type select ("Tipe apa saja" + the kos's distinct types with "{n} mengantre"), and a primary "Ikut Daftar Tunggu" button. Signed out → open the auth modal.
  - After joining: "Kamu antrean #N" with the type, the note "Kami kirim email saat kamar tersedia. Kamu punya 24 jam untuk memesan.", and a secondary "Keluar antrean" button.
  - With a live offer: a highlighted banner "Kamar {roomNumber} ditawarkan untukmu", a live countdown ("sisa 17 jam 42 menit"), a primary "Pesan Sekarang" button (selects that room and goes to checkout) and a secondary "Lewati".
  - In the room list, rooms with `reservedForWaitlist` show the badge "Dipesan antrean" and cannot be selected.
- **`/my-kos`:** a "Daftar Tunggu" section listing live entries (kos name, type, "Antrean #N" or the offer banner with the same actions), plus a collapsed history.
- **Owner workspace (`KosManager` for the selected kos):** a "Daftar Tunggu" table using the shared table classes (position, name + campus + verified badge, type, joined date, status dot, "Hapus" action with confirm). The dashboard summary shows the waitlist count as a stat.
- Hooks live in `frontend/src/lib/waitlist.ts`, following `lib/booking` and `lib/visits`. Keep Zod out of the initial chunk and run the bundle gate.

## Testing

Integration tests (`backend/tests/integration/waitlist.test.ts`, `callerFor` after `resetDb`), written first:

1. Join is refused while a matching bookable room exists. It succeeds when the kos is full, and when only other types are free.
2. Duplicate join → CONFLICT. A sixth live entry → BAD_REQUEST. An owner joining their own kos → FORBIDDEN. An unknown type → BAD_REQUEST.
3. Position maths: a mixed any/typed queue gives the expected numbers. Positions go down after leave, offer and removal.
4. Ending a tenancy offers the room to #1 (inline advance), queues a `waitlist-offer` outbox row, and leaves #2 waiting.
5. A type preference is respected: a freed "Standard" room skips a "Deluxe" entry and goes to the next matching entry or to "any".
6. Booking guard: another user booking the offered room → CONFLICT. The offeree booking it → success and FULFILLED. Queue-jump: a hold lapses (clock advanced, no tick run), then a stranger tries to book that room → CONFLICT, because booking.create advanced the queue first and #1 now holds the offer.
7. Lapse: advance the clock past `offerExpiresAt` and call `advanceAllWaitlists` → EXPIRED, the next entry is OFFERED.
8. Decline → DECLINED and passed on. Leave while OFFERED → passed on.
9. An unpaid hold from a waitlist booking lapses → the next tick offers the room to the next entry.
10. Owner remove: entries scoped to `kosId` (someone else's kos → NOT_FOUND). `waitlistEntries` order and positions.
11. Kos and room delete are refused while a live offer exists.
12. `resetDemo` removes demo users' entries and keeps real users' entries.
13. Concurrency (`tests/concurrency/`): two parallel `advanceAllWaitlists` calls produce exactly one offer per room and one per entry.

Shared unit tests for `competes`, `queuePosition` and `matchOffers`.

E2E (`e2e/tests/waitlist.spec.ts`): a demo student opens a full demo kos, joins and sees "antrean #1"; the owner ends a tenancy in the dashboard; the student reloads and sees the offer banner and can reach checkout. Do not use "Reset data demo". Clean up by leaving or declining.

## Docs

- `docs/adr/0014-waitlist-fifo-offers.md`: stored offers plus an interval tick, why not pure on-read (the notification has to fire while nobody is reading), and why not notify everyone (it makes the number meaningless).
- `CONTEXT.md`: add the `waitlist` router to the map and the gotcha that bookable ≠ vacant when a live offer exists.

## Out of scope

WhatsApp or push alerts (spec §15), owner reordering, budget caps, waitlists across several kos, emails on join, lapse or removal, and keeping your place after declining.

---

## Implementation plan (for the executing agent)

Work test-first, one phase at a time, and run the listed gate before moving on.

1. **Schema:** add the enum, model and back-relations, run `npm run db:migrate` (name `waitlist`), then append the two partial unique indexes to the generated migration (or a second hand-written migration, as in `20261002120000_visit_one_scheduled`). Regenerate the client. Gate: `npm run db:diff -w backend`, `npm run typecheck`.
2. **Shared domain:** `waitlist.ts` + unit tests, schemas, types, exported from the existing entry points. Gate: `npm test -w packages/shared` (or the workspace's test script).
3. **Server engine:** `backend/src/waitlist.ts` with `advanceWaitlist(tx, kosId, now)`, `advanceAllWaitlists(prisma, now)`, `startWaitlistWorker(prisma, intervalMs = 60_000)` (copy the outbox worker's pattern and start it in `index.ts`). Add the `waitlist-offer` email template. Tests 4, 5, 7, 9 and 13.
4. **Router + guards:** the `waitlist` router, the booking guard in `booking.create`, the inline advance calls in owner mutations, the owner query and remove, the `BoardSummary.waitlistCount`, the delete guards, `reservedForWaitlist`/`offeredToMe` on kos detail rooms, and the `resetDemo` scoping. Tests 1–3, 6, 8, 10–12. Gate: `npm test`, `npm run typecheck`.
5. **Frontend:** `lib/waitlist.ts` hooks, sidebar and mobile CTA states, the room badge, the My Kos section, the owner table and stat. Gate: `npm run typecheck`, `npm run build && npm run bundle:check`. Check visually at 1280x650, 1600x900 and 390px.
6. **E2E + docs:** the waitlist spec, ADR 0014, the CONTEXT.md update. Gate: the full verification list in CONTEXT.md (`npm run e2e` needs Postgres via Docker; if it isn't running, say so and don't claim e2e passed).
