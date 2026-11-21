import type { PrismaClient } from '../db/client.ts'
import { beat, registerWorker, staleAfter } from '../health.ts'
import { startPeriodic, type StopWorker } from '../worker.ts'
import { approveOwner, ReviewError } from './review.ts'

const WORKER = 'owner-auto-review'
const TICK_MS = 5_000

/**
 * Demo only (OWNER_AUTO_REVIEW_SECONDS): approves every MENUNGGU owner whose newest pending document is at least
 * `seconds` old, through the same approveOwner() the CLI uses. Returns how many were approved.
 */
export async function autoReviewOwners(prisma: PrismaClient, seconds: number, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - seconds * 1000)
  const waiting = await prisma.ownerProfile.findMany({ where: { verificationStatus: 'MENUNGGU' }, select: { userId: true }, take: 100 })
  let approved = 0
  for (const w of waiting) {
    const newest = await prisma.ownerDocument.findFirst({ where: { userId: w.userId, status: 'PENDING', deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
    if (!newest || newest.createdAt > cutoff) continue
    try {
      await approveOwner(prisma, w.userId, { reviewer: 'auto-review' }, now)
      approved++
    } catch (e) {
      if (!(e instanceof ReviewError)) throw e // lost a race with the CLI: someone else decided
    }
  }
  return approved
}

/** Started from index.ts when OWNER_AUTO_REVIEW_SECONDS is set (also under e2e: the demo and e2e need it). */
export function startOwnerAutoReview(prisma: PrismaClient, seconds: number): StopWorker {
  registerWorker(WORKER, staleAfter(TICK_MS))
  return startPeriodic(WORKER, TICK_MS, async () => {
    await autoReviewOwners(prisma, seconds)
    beat(WORKER)
  })
}
