# 0014. Daftar tunggu: FIFO queue with stored offers and an interval tick

**Context.** A full kos was a dead end: a student could only refresh and hope to win the race when a hold lapsed or a tenant moved out. Competitors notify every waiting student at once, so the first to book wins and a "position" means nothing.

**Decision.** A `WaitlistEntry` joins one kos for one room type or any type. The queue number is computed on read (ADR 0005): one plus the earlier WAITING entries whose preference competes with yours. When a room is free, `advanceWaitlist` stores an **offer** on the first matching entry (`OFFERED`, the room, a 24 h deadline) and queues the email through the outbox (ADR 0009). It runs for one kos inside a transaction that locks the kos row, inline after anything that frees a room (move-out, new room, type change, decline, leave, owner removal) and every 60 s from a worker started in `index.ts`. `booking.create` also advances before it inserts, so a hold that lapsed lazily cannot be taken by a stranger in the gap before the next tick; the guard refuses a room offered to someone else. Two hand-written partial unique indexes (ADR 0004) keep one live entry per student per kos and one live offer per room.

**Why not pure on-read.** The notification has to fire while nobody is reading, and "who is next" must be a stored fact the booking guard can check. Computing offers on read would also let two readers disagree.

**Why not notify everyone.** It turns the number into decoration and brings back the race. A stored offer with an exclusive window makes "Antrean #3" a promise.

**Consequences.** Offers can lag by up to 60 s when the trigger is lazy (a lapsed hold nobody touches); the booking path and the join path close that gap for anyone who could exploit it. A student who lets an offer lapse, declines or leaves loses the place. Deleting a kos or room is refused while a live offer exists. The demo reset removes demo entries (ADR 0013).
