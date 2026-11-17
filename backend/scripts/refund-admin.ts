// Operator tool for refunds that automation cannot finish. Read docs/ in deploy/XENDIT_RUNBOOK.md section 6 first.
//
//   npm run refunds:admin -w backend -- list
//   npm run refunds:admin -w backend -- resolve <refundId> succeeded|failed     (after checking the provider dashboard)
//   npm run refunds:admin -w backend -- requeue <refundId> --confirm-not-refunded
import '../src/env.ts'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'
import { listStuckRefunds, requeueRefund, resolveRefund } from '../src/payment/refunds.ts'

const [command, refundId, arg] = process.argv.slice(2)
const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  if (command === 'list') {
    console.table(await listStuckRefunds(prisma))
  } else if (command === 'resolve' && refundId && (arg === 'succeeded' || arg === 'failed')) {
    console.log(await resolveRefund(prisma, refundId, arg === 'succeeded' ? 'SUCCEEDED' : 'FAILED'))
  } else if (command === 'requeue' && refundId) {
    console.log(await requeueRefund(prisma, refundId, { confirmNotRefunded: process.argv.includes('--confirm-not-refunded') }))
  } else {
    console.error('Usage: list | resolve <refundId> succeeded|failed | requeue <refundId> --confirm-not-refunded')
    process.exitCode = 2
  }
} finally {
  await prisma.$disconnect()
}
