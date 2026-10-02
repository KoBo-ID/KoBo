import { Cron } from 'croner'
import type { PrismaClient } from './db/client.ts'
import { resetDemo } from './demoReset.ts'

/** 03:30 every night, Jakarta time (WIB has no DST, so this is 20:30 UTC). */
export const DEMO_RESET_CRON = '30 3 * * *'
export const DEMO_RESET_TZ = 'Asia/Jakarta'

/** Next nightly reset strictly after `from`. */
export function nextDemoReset(from: Date): Date {
  return new Cron(DEMO_RESET_CRON, { timezone: DEMO_RESET_TZ, paused: true }).nextRun(from)!
}

/** Started from index.ts only (tests call resetDemo directly). Returns a stop function. */
export function startDemoReset(prisma: PrismaClient): () => void {
  const job = new Cron(DEMO_RESET_CRON, { timezone: DEMO_RESET_TZ, protect: true }, async () => {
    try {
      await resetDemo(prisma, new Date())
      console.log('[demo] nightly reset done')
    } catch (err) {
      console.error('[demo] nightly reset failed:', err instanceof Error ? err.message : err)
    }
  })
  return () => job.stop()
}
