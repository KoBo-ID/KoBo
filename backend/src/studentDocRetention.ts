import { Cron } from 'croner'
import type { PrismaClient } from './db/client.ts'
import { beat, DAILY_STALE_MS, registerWorker } from './health.ts'
import type { Storage } from './storage.ts'

const PURGE_BATCH = 200
const PURGE_CONCURRENCY = 10

/** Deletes KTM objects whose retention ended, then marks the rows deleted. Idempotent. Logs counts only, never keys. */
export async function purgeStudentDocuments(prisma: PrismaClient, storage: Storage, now: Date): Promise<number> {
  let count = 0
  let after = ''
  // Batches by id cursor: a row whose delete keeps failing is skipped for this run instead of blocking or looping.
  for (;;) {
    const due = await prisma.studentDocument.findMany({
      where: { deleteAfter: { lte: now }, deletedAt: null, id: { gt: after } },
      orderBy: { id: 'asc' },
      take: PURGE_BATCH,
      select: { id: true, key: true },
    })
    if (due.length === 0) break
    // Storage deletes run in parallel chunks; the rows whose object is gone are marked in one updateMany per batch.
    const done: string[] = []
    for (let i = 0; i < due.length; i += PURGE_CONCURRENCY) {
      const results = await Promise.allSettled(due.slice(i, i + PURGE_CONCURRENCY).map((d) => storage.deletePrivate(d.key).then(() => d.id)))
      for (const r of results) if (r.status === 'fulfilled') done.push(r.value) // a failed delete is left for the next run
    }
    if (done.length > 0) {
      try {
        await prisma.studentDocument.updateMany({ where: { id: { in: done } }, data: { deletedAt: now } })
        count += done.length
      } catch {
        // Objects are already gone; the next run re-deletes them (idempotent) and marks the rows.
      }
    }
    after = due[due.length - 1]!.id
  }
  return count
}

/** Account deletion: remove every stored KTM object of the user (the rows go with the User cascade). Returns the object count. */
export async function deleteUserStudentDocuments(prisma: PrismaClient, storage: Storage, userId: string): Promise<number> {
  const docs = await prisma.studentDocument.findMany({ where: { userId, deletedAt: null }, select: { key: true }, take: 500 })
  let count = 0
  for (const d of docs) {
    await storage.deletePrivate(d.key)
    count++
  }
  return count
}

/** 04:10 Jakarta time every day. Started from index.ts only (tests call purgeStudentDocuments directly). */
export const STUDENT_DOC_RETENTION_CRON = '10 4 * * *'

export function startStudentDocRetention(prisma: PrismaClient, storage: Storage): () => void {
  registerWorker('student-doc-retention', DAILY_STALE_MS)
  const job = new Cron(STUDENT_DOC_RETENTION_CRON, { timezone: 'Asia/Jakarta', protect: true }, async () => {
    try {
      const n = await purgeStudentDocuments(prisma, storage, new Date())
      beat('student-doc-retention')
      console.log(`[students] retention purged ${n} document(s)`)
    } catch (err) {
      console.error('[students] retention failed:', err instanceof Error ? err.message : err)
    }
  })
  return () => job.stop()
}
