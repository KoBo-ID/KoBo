import { compareQueue, matchOffers, OFFER_HOURS } from '@kobo/shared/domain'
import type { PrismaClient } from './db/client.ts'
import type { Prisma } from './generated/prisma/client.ts'
import { heartbeatJob } from './health.ts'
import { startPeriodic, type StopWorker } from './worker.ts'

/*
 * Daftar tunggu engine (docs/superpowers/specs/2026-10-02-waitlist-design.md, ADR 0014). Offers are stored on the
 * entry and handed out FIFO by advanceWaitlist(), which runs inline after anything that frees a room and from a
 * 60 s worker (started in index.ts, never from createApp: tests call it directly).
 */

type Tx = Prisma.TransactionClient

/**
 * Lock order (A-001): Kos FOR UPDATE → Invoice → Payment → PaymentRefund → Tenancy → WaitlistEntry writes. Any tx that may change room availability or waitlist rows calls lockKos first; resolve kosId with an unlocked read beforehand.
 */
export async function lockKos(tx: Tx, kosId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Kos" WHERE id = ${kosId} FOR UPDATE`
}

/**
 * A live offer (A-007): OFFERED and either inside its deadline or held by a PENDING application the offeree filed for
 * the offered room. A rejected or withdrawn application ends the offer at once, whatever the deadline says.
 */
export const liveOffer = (now: Date): Prisma.WaitlistEntryWhereInput => ({
  status: 'OFFERED',
  NOT: { application: { status: { in: ['REJECTED', 'WITHDRAWN'] } } },
  OR: [{ offerExpiresAt: { gte: now } }, { application: { status: 'PENDING' } }],
})

/**
 * Read-only: which user each room is held for right now. A live offer, or the first waiter that advanceWaitlist()
 * would offer it to on its next run. Public reads use this so "full" and the room list agree with what booking
 * will do, without writing on a GET.
 */
export async function roomClaims(db: Tx, kosId: string, now: Date): Promise<Map<string, string>> {
  const offers = await db.waitlistEntry.findMany({ where: { kosId, ...liveOffer(now) }, select: { userId: true, offeredRoomId: true } })
  const claims = new Map<string, string>()
  for (const o of offers) if (o.offeredRoomId) claims.set(o.offeredRoomId, o.userId)

  const waiting = await db.waitlistEntry.findMany({
    where: { kosId, status: 'WAITING', kos: { archivedAt: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true, roomType: true, createdAt: true },
  })
  if (waiting.length === 0) return claims
  const rooms = await db.room.findMany({
    where: {
      kosId,
      archivedAt: null,
      kos: { archivedAt: null },
      id: { notIn: [...claims.keys()] },
      tenancies: { none: { OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gt: now } }] } },
    },
    orderBy: { roomNumber: 'asc' },
    select: { id: true, type: true },
  })
  const userOf = new Map(waiting.map((w) => [w.id, w.userId]))
  for (const o of matchOffers([...waiting].sort(compareQueue), rooms)) claims.set(o.roomId, userOf.get(o.entryId)!)
  return claims
}

/**
 * Lapse stale offers, then offer every free room to the first matching WAITING entry. Locks the kos row first so
 * concurrent runs for one kos serialise. Returns the number of new offers. Must run inside a transaction.
 */
export async function advanceWaitlist(tx: Tx, kosId: string, now: Date): Promise<number> {
  await lockKos(tx, kosId)

  // Resolve offers that are no longer live (A-007). An offer past its deadline lapses unless the offeree's application
  // for the room is still PENDING (the owner is reviewing it); an approved one is accepted, a rejected or withdrawn
  // one ends at once so the room moves on in this same pass.
  await tx.waitlistEntry.updateMany({ where: { kosId, status: 'OFFERED', application: { status: 'APPROVED' } }, data: { status: 'FULFILLED', resolvedAt: now } })
  await tx.waitlistEntry.updateMany({
    where: {
      kosId,
      status: 'OFFERED',
      OR: [{ application: { status: { in: ['REJECTED', 'WITHDRAWN'] } } }, { offerExpiresAt: { lt: now }, NOT: { application: { status: 'PENDING' } } }],
    },
    data: { status: 'EXPIRED', resolvedAt: now },
  })

  // An archived (deleted) kos never hands out offers (A-002).
  const kos = await tx.kos.findUnique({ where: { id: kosId }, select: { archivedAt: true } })
  if (!kos || kos.archivedAt) return 0

  const waiting = await tx.waitlistEntry.findMany({
    where: { kosId, status: 'WAITING' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { user: { select: { name: true, email: true } }, kos: { select: { name: true } } },
  })
  if (waiting.length === 0) return 0

  const rooms = await tx.room.findMany({
    where: {
      kosId,
      archivedAt: null,
      tenancies: { none: { OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gt: now } }] } },
      waitlistOffers: { none: { status: 'OFFERED' } },
    },
    orderBy: { roomNumber: 'asc' },
    select: { id: true, type: true, roomNumber: true },
  })
  const offers = matchOffers(waiting, rooms)
  if (offers.length === 0) return 0

  const origin = (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
  const offerExpiresAt = new Date(now.getTime() + OFFER_HOURS * 3600_000)
  // Each entry gets its own room, so the updates cannot be one updateMany; run them together, and the emails as one insert (H-002).
  const planned = offers.map((o) => ({ entry: waiting.find((w) => w.id === o.entryId)!, room: rooms.find((r) => r.id === o.roomId)! }))
  await Promise.all(planned.map(({ entry, room }) => tx.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'OFFERED', offeredRoomId: room.id, offerExpiresAt } })))
  await tx.emailOutbox.createMany({
    data: planned.map(({ entry, room }) => ({
      to: entry.user.email,
      template: 'waitlist-offer',
      payload: { name: entry.user.name, kosName: entry.kos.name, roomNumber: room.roomNumber, expiresAt: offerExpiresAt.toISOString(), url: `${origin}/kos/${kosId}` },
    })),
  })
  return offers.length
}

/** Every kos with a live entry, each in its own transaction (one slow or failing kos does not block the rest). */
export async function advanceAllWaitlists(prisma: PrismaClient, now: Date = new Date()): Promise<number> {
  const kos = await prisma.waitlistEntry.findMany({ where: { status: { in: ['WAITING', 'OFFERED'] } }, distinct: ['kosId'], select: { kosId: true } })
  let offered = 0
  for (const { kosId } of kos) {
    try {
      offered += await prisma.$transaction((tx) => advanceWaitlist(tx, kosId, now))
    } catch (err) {
      // One failing kos must not starve the rest of the tick (it is retried on the next one).
      console.error(`[waitlist] advance failed for kos ${kosId}:`, err instanceof Error ? err.message : err)
    }
  }
  return offered
}

/** Start the periodic advance. Ticks never overlap within this process. Returns a stop function. */
export function startWaitlistWorker(prisma: PrismaClient, intervalMs = 15_000): StopWorker {
  return startPeriodic('waitlist', intervalMs, heartbeatJob('waitlist', intervalMs, () => advanceAllWaitlists(prisma)))
}
