// Operator tool: approve a newly registered owner so their kos appear publicly.
//
//   npm run owners:approve -w backend -- list              (owners still waiting, oldest first)
//   npm run owners:approve -w backend -- <email>           (approve)
//   npm run owners:approve -w backend -- revoke <email>    (hide their kos again)
//
// Before approving, check the WhatsApp number on the owner's profile and that the kos address, map pin and photos are real.
import '../src/env.ts'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'

const [first, second] = process.argv.slice(2)
const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  if (first === 'list') {
    const rows = await prisma.ownerProfile.findMany({
      where: { approvedAt: null },
      orderBy: { memberSince: 'asc' },
      select: { memberSince: true, user: { select: { email: true, name: true, phone: true } }, _count: { select: { kos: true } } },
    })
    console.table(rows.map((r) => ({ since: r.memberSince.toISOString().slice(0, 10), email: r.user.email, name: r.user.name, phone: r.user.phone, kos: r._count.kos })))
  } else if (first === 'revoke' && second) {
    const res = await prisma.ownerProfile.updateMany({ where: { user: { email: second.toLowerCase() } }, data: { approvedAt: null } })
    console.log(res.count ? `Hidden: ${second}` : `No owner with email ${second}`)
  } else if (first && first.includes('@')) {
    const res = await prisma.ownerProfile.updateMany({ where: { user: { email: first.toLowerCase() }, approvedAt: null }, data: { approvedAt: new Date() } })
    console.log(res.count ? `Approved: ${first}` : `Nothing to approve for ${first} (unknown email, or already approved)`)
  } else {
    console.error('Usage: list | <email> | revoke <email>')
    process.exitCode = 2
  }
} finally {
  await prisma.$disconnect()
}
