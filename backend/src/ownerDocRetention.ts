import { Cron } from 'croner'
import type { PrismaClient } from './db/client.ts'
import { beat, DAILY_STALE_MS, registerWorker } from './health.ts'
import type { Storage } from './storage.ts'

const PURGE_BATCH = 200
const PURGE_CONCURRENCY = 10

/** Deletes owner-document objects whose retention ended, then marks the rows deleted. Idempotent. Logs counts only, never keys. */
export async function purgeOwnerDocuments(prisma: PrismaClient, storage: Storage, now: Date): Promise<number> {
  let count = 0
  let after = ''
  for (;;) {
    const due = await prisma.ownerDocument.findMany({
      where: { deleteAfter: { lte: now }, deletedAt: null, id: { gt: after } },
      orderBy: { id: 'asc' },
      take: PURGE_BATCH,
      select: { id: true, key: true },
    })
    if (due.length === 0) break
    const done: string[] = []
    for (let i = 0; i < due.length; i += PURGE_CONCURRENCY) {
      const results = await Promise.allSettled(due.slice(i, i + PURGE_CONCURRENCY).map((d) => storage.deletePrivate(d.key).then(() => d.id)))
      for (const r of results) if (r.status === 'fulfilled') done.push(r.value) // a failed delete is left for the next run
    }
    if (done.length > 0) {
      try {
        await prisma.ownerDocument.updateMany({ where: { id: { in: done } }, data: { deletedAt: now } })
        count += done.length
      } catch {
        // Objects are already gone; the next run re-deletes them (idempotent) and marks the rows.
      }
    }
    after = due[due.length - 1]!.id
  }
  return count
}

/** Account deletion: remove every stored owner-document object of the user (the rows go with the User cascade). Returns the object count. */
export async function deleteUserOwnerDocuments(prisma: PrismaClient, storage: Storage, userId: string): Promise<number> {
  const docs = await prisma.ownerDocument.findMany({ where: { userId, deletedAt: null }, select: { key: true }, take: 500 })
  let count = 0
  for (const d of docs) {
    await storage.deletePrivate(d.key)
    count++
  }
  return count
}

/** 04:20 Jakarta time every day (ten minutes after the KTM purge). Started from index.ts only. */
export const OWNER_DOC_RETENTION_CRON = '20 4 * * *'

export function startOwnerDocRetention(prisma: PrismaClient, storage: Storage): () => void {
  registerWorker('owner-doc-retention', DAILY_STALE_MS)
  const job = new Cron(OWNER_DOC_RETENTION_CRON, { timezone: 'Asia/Jakarta', protect: true }, async () => {
    try {
      const n = await purgeOwnerDocuments(prisma, storage, new Date())
      beat('owner-doc-retention')
      console.log(`[owners] retention purged ${n} document(s)`)
    } catch (err) {
      console.error('[owners] retention failed:', err instanceof Error ? err.message : err)
    }
  })
  return () => job.stop()
}
