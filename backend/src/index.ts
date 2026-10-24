import { serve } from '@hono/node-server'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { createPrisma } from './db/client.ts'
import { startDemoReset } from './demoSchedule.ts'
import { createE2eHooks } from './e2eHooks.ts'
import { e2eHooksEnabled, requireEnv } from './env.ts'
import { startOutboxWorker, transportFromEnv } from './outbox.ts'
import { startPaymentSweep } from './payment/reconcile.ts'
import { startRefundWorker } from './payment/refunds.ts'
import { paymentServiceFromEnv } from './payment/service.ts'
import { startWaitlistWorker } from './waitlist.ts'

const prisma = createPrisma(requireEnv('DATABASE_URL'))
const port = Number(process.env.PORT ?? 3000)
const distDir =
  process.env.NODE_ENV === 'production'
    ? (process.env.FRONTEND_DIST ?? fileURLToPath(new URL('../../frontend/dist', import.meta.url)))
    : undefined

// Test/e2e only (ALLOW_E2E_HOOKS=1, guarded in env.ts): swaps in a fake Xendit provider and mounts /api/__e2e/*.
const e2eHooks = e2eHooksEnabled() ? createE2eHooks(prisma) : null
const paymentService = e2eHooks?.paymentService ?? paymentServiceFromEnv()
const server = serve({ fetch: createApp({ prisma, distDir, paymentService, e2eHooks }).fetch, port }, (info) => {
  console.log(`KoBo server listening on :${info.port}${distDir ? ` (serving ${distDir})` : ''}`)
})

// Not started from createApp: tests call drainOutbox() directly.
const stopOutbox = startOutboxWorker(prisma, transportFromEnv(), 15_000)

// Also not started from createApp: tests call drainPaymentRefunds() directly.
const stopRefunds = startRefundWorker(prisma, paymentService, 15_000)

// Also not started from createApp: tests call sweepStalePayments() directly. Recovers payments whose callbacks were lost.
const stopPaymentSweep = startPaymentSweep(prisma, paymentService)

// Also not started from createApp: tests call advanceAllWaitlists() directly.
const stopWaitlist = startWaitlistWorker(prisma)

// Also not started from createApp. Restores demo-owned rows only (demoReset.ts).
// e2e: a 03:30 reset would wipe rows mid-suite.
const stopDemoReset = e2eHooks ? () => {} : startDemoReset(prisma)

const shutdown = () => {
  stopOutbox()
  stopRefunds()
  stopPaymentSweep()
  stopWaitlist()
  stopDemoReset()
  server.close(() => void prisma.$disconnect().finally(() => process.exit(0)))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
