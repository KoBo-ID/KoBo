import { matchOffers, OFFER_HOURS } from '@kobo/shared/domain'
import type { PrismaClient } from './db/client.ts'
import type { Prisma } from './generated/prisma/client.ts'
import { enqueueEmail } from './outbox.ts'

/*
 * Daftar tunggu engine (docs/superpowers/specs/2026-10-02-waitlist-design.md, ADR 0014). Offers are stored on the
 * entry and handed out FIFO by advanceWaitlist(), which runs inline after anything that frees a room and from a
 * 60 s worker (started in index.ts, never from createApp: tests call it directly).
 */

type Tx = Prisma.TransactionClient

/** A live offer: OFFERED and not past its deadline. */
export const liveOffer = (now: Date): Prisma.WaitlistEntryWhereInput => ({ status: 'OFFERED', offerExpiresAt: { gte: now } })

/**
 * Lapse stale offers, then offer every free room to the first matching WAITING entry. Locks the kos row first so
 * concurrent runs for one kos serialise. Returns the number of new offers. Must run inside a transaction.
 */
export async function advanceWaitlist(tx: Tx, kosId: string, now: Date): Promise<number> {
  await tx.$queryRaw`SELECT id FROM "Kos" WHERE id = ${kosId} FOR UPDATE`

  await tx.waitlistEntry.updateMany({
    where: { kosId, status: 'OFFERED', offerExpiresAt: { lt: now } },
    data: { status: 'EXPIRED', resolvedAt: now },
  })

  const waiting = await tx.waitlistEntry.findMany({
    where: { kosId, status: 'WAITING' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { user: { select: { name: true, email: true } }, kos: { select: { name: true } } },
  })
  if (waiting.length === 0) return 0

  const rooms = await tx.room.findMany({
    where: {
      kosId,
      tenancies: { none: { OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gte: now } }] } },
      waitlistOffers: { none: { status: 'OFFERED' } },
    },
    orderBy: { roomNumber: 'asc' },
    select: { id: true, type: true, roomNumber: true },
  })
  const offers = matchOffers(waiting, rooms)
  if (offers.length === 0) return 0

  const origin = (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
  const offerExpiresAt = new Date(now.getTime() + OFFER_HOURS * 3600_000)
  for (const o of offers) {
    const entry = waiting.find((w) => w.id === o.entryId)!
    const room = rooms.find((r) => r.id === o.roomId)!
    await tx.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'OFFERED', offeredRoomId: room.id, offerExpiresAt } })
    await enqueueEmail(tx, {
      to: entry.user.email,
      template: 'waitlist-offer',
      payload: { name: entry.user.name, kosName: entry.kos.name, roomNumber: room.roomNumber, expiresAt: offerExpiresAt.toISOString(), url: `${origin}/kos/${kosId}` },
    })
  }
  return offers.length
}

/** Every kos with a live entry, each in its own transaction (one slow or failing kos does not block the rest). */
export async function advanceAllWaitlists(prisma: PrismaClient, now: Date = new Date()): Promise<number> {
  const kos = await prisma.waitlistEntry.findMany({ where: { status: { in: ['WAITING', 'OFFERED'] } }, distinct: ['kosId'], select: { kosId: true } })
  let offered = 0
  for (const { kosId } of kos) offered += await prisma.$transaction((tx) => advanceWaitlist(tx, kosId, now))
  return offered
}

/** Start the periodic advance. Ticks never overlap within this process. Returns a stop function. */
export function startWaitlistWorker(prisma: PrismaClient, intervalMs = 60_000): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await advanceAllWaitlists(prisma)
    } catch (err) {
      console.error('[waitlist] advance failed:', err instanceof Error ? err.message : err)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  return () => clearInterval(timer)
}
