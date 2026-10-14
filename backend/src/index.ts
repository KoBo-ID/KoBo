import { serve } from '@hono/node-server'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { createPrisma } from './db/client.ts'
import { startDemoReset } from './demoSchedule.ts'
import { requireEnv } from './env.ts'
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

const paymentService = paymentServiceFromEnv()
const server = serve({ fetch: createApp({ prisma, distDir, paymentService }).fetch, port }, (info) => {
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
const stopDemoReset = startDemoReset(prisma)

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
