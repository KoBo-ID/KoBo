import { addDays, todayWIB } from '@kobo/shared/domain'
import type { PrismaClient } from '../db/client.ts'
import { beat, registerWorker, staleAfter } from '../health.ts'
import { startPeriodic, type StopWorker } from '../worker.ts'
import { approveDocument, ReviewError } from './review.ts'

const WORKER = 'ktm-auto-review'
const TICK_MS = 15_000

/**
 * Demo only (KTM_AUTO_REVIEW_SECONDS): approves every PENDING KTM at least `seconds` old through the same approveDocument()
 * the CLI uses (so verifiedCampusId, the email and the retention clock all behave as for a human decision). validUntil is
 * the date the student typed, else (or if already past) 12 months out; approveDocument refuses more than 365 days, so the
 * day is clamped to today + 364. Returns how many were approved.
 */
export async function autoReviewKtm(prisma: PrismaClient, seconds: number, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - seconds * 1000)
  const today = todayWIB(now)
  const max = addDays(today, 364)
  const waiting = await prisma.studentDocument.findMany({
    where: { kind: 'KTM', status: 'PENDING', deletedAt: null, createdAt: { lte: cutoff } },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true, claimedValidUntil: true },
  })
  let approved = 0
  for (const w of waiting) {
    const claimed = w.claimedValidUntil?.toISOString().slice(0, 10)
    const day = claimed && claimed >= today ? (claimed > max ? max : claimed) : max
    try {
      await approveDocument(prisma, w.id, { reviewer: 'auto-review', validUntil: day }, now)
      approved++
    } catch (e) {
      if (!(e instanceof ReviewError)) throw e // lost a race with the CLI or a withdraw
    }
  }
  return approved
}

/** Started from index.ts when KTM_AUTO_REVIEW_SECONDS is set (also under e2e). */
export function startKtmAutoReview(prisma: PrismaClient, seconds: number): StopWorker {
  registerWorker(WORKER, staleAfter(TICK_MS))
  return startPeriodic(WORKER, TICK_MS, async () => {
    await autoReviewKtm(prisma, seconds)
    beat(WORKER)
  })
}
