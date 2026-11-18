import { Cron } from 'croner'
import type { PrismaClient } from './db/client.ts'
import type { Storage } from './storage.ts'

/** Deletes KTM objects whose retention ended, then marks the rows deleted. Idempotent. Logs counts only, never keys. */
export async function purgeStudentDocuments(prisma: PrismaClient, storage: Storage, now: Date): Promise<number> {
  const due = await prisma.studentDocument.findMany({ where: { deleteAfter: { lte: now }, deletedAt: null }, select: { id: true, key: true } })
  let count = 0
  for (const d of due) {
    try {
      await storage.deletePrivate(d.key)
      await prisma.studentDocument.update({ where: { id: d.id }, data: { deletedAt: now } })
      count++
    } catch {
      // Left for the next run.
    }
  }
  return count
}

/** Account deletion: remove every stored KTM object of the user (the rows go with the User cascade). Returns the object count. */
export async function deleteUserStudentDocuments(prisma: PrismaClient, storage: Storage, userId: string): Promise<number> {
  const docs = await prisma.studentDocument.findMany({ where: { userId, deletedAt: null }, select: { key: true } })
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
  const job = new Cron(STUDENT_DOC_RETENTION_CRON, { timezone: 'Asia/Jakarta', protect: true }, async () => {
    try {
      const n = await purgeStudentDocuments(prisma, storage, new Date())
      console.log(`[students] retention purged ${n} document(s)`)
    } catch (err) {
      console.error('[students] retention failed:', err instanceof Error ? err.message : err)
    }
  })
  return () => job.stop()
}
