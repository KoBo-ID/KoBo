import { Cron } from 'croner'
import { beat, DAILY_STALE_MS, registerWorker } from './health.ts'
import type { PrismaClient } from './db/client.ts'

/** An account that never confirmed its email within this many days is removed. */
export const UNVERIFIED_MAX_AGE_DAYS = 7

/**
 * Deletes accounts that signed up with email + password but never verified the address: squatted or mistyped sign-ups.
 * Defensive: anyone with an owner profile, tenancy, application, visit, waitlist entry, payment, profile view or stored
 * KTM is kept, and demo accounts never go. Sessions, accounts and campus-email challenges go with the User cascade
 * (EmailOutbox rows have no user FK and expire on their own). Returns the count; never logs addresses.
 */
export async function purgeUnverifiedUsers(prisma: PrismaClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - UNVERIFIED_MAX_AGE_DAYS * 86_400_000)
  const { count } = await prisma.user.deleteMany({
    where: {
      emailVerified: false,
      isDemo: false,
      createdAt: { lt: cutoff },
      ownerProfile: { is: null },
      tenancies: { none: {} },
      rentalApplications: { none: {} },
      visits: { none: {} },
      waitlistEntries: { none: {} },
      recordedPayments: { none: {} },
      profileViewsMade: { none: {} },
      profileViewsOfMe: { none: {} },
      studentDocuments: { none: {} },
    },
  })
  return count
}

/** 04:40 Jakarta time every day. Started from index.ts only (tests call purgeUnverifiedUsers directly). */
export const UNVERIFIED_CLEANUP_CRON = '40 4 * * *'

export function startUnverifiedCleanup(prisma: PrismaClient): () => void {
  registerWorker('unverified-cleanup', DAILY_STALE_MS)
  const job = new Cron(UNVERIFIED_CLEANUP_CRON, { timezone: 'Asia/Jakarta', protect: true }, async () => {
    try {
      const n = await purgeUnverifiedUsers(prisma, new Date())
      console.log(`[auth] purged ${n} unverified account(s)`)
      beat('unverified-cleanup')
    } catch (err) {
      console.error('[auth] unverified cleanup failed:', err instanceof Error ? err.message : err)
    }
  })
  return () => job.stop()
}
