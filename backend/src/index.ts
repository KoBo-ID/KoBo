import { serve } from '@hono/node-server'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { createPrisma } from './db/client.ts'
import { startDemoReset } from './demoSchedule.ts'
import { e2eHooksEnabled, requireEnv } from './env.ts'
import { startNotificationWorker, whatsappFromEnv } from './notifications.ts'
import { startOutboxWorker, transportFromEnv } from './outbox.ts'
import { startPaymentSweep } from './payment/reconcile.ts'
import { startRefundWorker } from './payment/refunds.ts'
import { paymentServiceFromEnv } from './payment/service.ts'
import { storageFromEnv } from './storage.ts'
import { startStudentDocRetention } from './studentDocRetention.ts'
import { startUnverifiedCleanup } from './unverifiedCleanup.ts'
import { startWaitlistWorker } from './waitlist.ts'

const prisma = createPrisma(requireEnv('DATABASE_URL'))
const port = Number(process.env.PORT ?? 3000)
const distDir =
  process.env.NODE_ENV === 'production'
    ? (process.env.FRONTEND_DIST ?? fileURLToPath(new URL('../../frontend/dist', import.meta.url)))
    : undefined

// Test/e2e only (ALLOW_E2E_HOOKS=1, guarded in env.ts): swaps in a fake Xendit provider and mounts /api/__e2e/*.
// Dynamic import: a production start never loads e2eHooks.ts.
const e2e = e2eHooksEnabled() ? (await import('./e2eHooks.ts')).wireE2e(prisma) : null
const paymentService = e2e?.paymentService ?? paymentServiceFromEnv()
const storage = storageFromEnv()
const server = serve({ fetch: createApp({ prisma, distDir, paymentService, e2eMount: e2e?.mount, storage }).fetch, port }, (info) => {
  console.log(`KoBo server listening on :${info.port}${distDir ? ` (serving ${distDir})` : ''}`)
})

// Not started from createApp: tests call drainOutbox() directly.
const stopOutbox = startOutboxWorker(prisma, transportFromEnv(), 15_000)

// Also not started from createApp: tests call drainPaymentRefunds() directly.
const stopRefunds = startRefundWorker(prisma, paymentService, 15_000)

// Also not started from createApp: tests call sweepStalePayments() directly. Recovers payments whose callbacks were lost.
const stopPaymentSweep = startPaymentSweep(prisma, paymentService)

// Also not started from createApp: tests call scanNotifications() with their own clock. WhatsApp only logs until a provider is wired.
const stopNotifications = startNotificationWorker(prisma, { whatsapp: whatsappFromEnv() })

// Also not started from createApp: tests call advanceAllWaitlists() directly.
const stopWaitlist = startWaitlistWorker(prisma)

// Also not started from createApp. Restores demo-owned rows only (demoReset.ts).
// e2e: a 03:30 reset would wipe rows mid-suite.
const stopDemoReset: () => void = e2e ? () => {} : startDemoReset(prisma)

// Also not started from createApp: tests call purgeStudentDocuments() directly. Deletes KTM photos 30 days after a decision.
// e2e: skipped, the fake private storage is in memory.
const stopStudentDocs: () => void = e2e ? () => {} : startStudentDocRetention(prisma, storage)
// Daily purge of sign-ups that never verified their email (7 days). Not started from createApp; e2e keeps its seeded users.
const stopUnverified: () => void = e2e ?() => {} : startUnverifiedCleanup(prisma)

// Compose gives the container 10 s (stop_grace_period). Stop taking requests, let the running ticks and in-flight
// requests finish (max 8 s), then close the pool, so a refund or email send is not cut off between the provider call
// and the row update.
const SHUTDOWN_WAIT_MS = 8_000
let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  const httpClosed = new Promise<void>((resolve) => server.close(() => resolve()))
  const workers = [stopOutbox(), stopNotifications(), stopRefunds(), stopPaymentSweep(), stopWaitlist(), Promise.resolve(stopDemoReset()), Promise.resolve(stopStudentDocs()), Promise.resolve(stopUnverified())]
  await Promise.race([Promise.allSettled([httpClosed, ...workers]), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref())])
  await prisma.$disconnect().catch(() => undefined)
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
