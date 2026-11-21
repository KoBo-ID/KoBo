// Operator tool: approve a registered owner so they can add kos and their kos appear publicly.
//
//   npm run owners:approve -w backend -- list              (owners not yet approved, oldest first)
//   npm run owners:approve -w backend -- <email>           (approve)
//   npm run owners:approve -w backend -- revoke <email>    (hide their kos again, status back to BELUM_KIRIM)
//
// Normal path is the document review (owners:review). This is the manual override. Check ownershipType and the owner's
// documents first: PENGELOLA_KUASA needs a surat kuasa.
import '../src/env.ts'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'

const [first, second] = process.argv.slice(2)
const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  if (first === 'list') {
    const rows = await prisma.ownerProfile.findMany({
      where: { verificationStatus: { not: 'DISETUJUI' } },
      orderBy: { memberSince: 'asc' },
      select: { memberSince: true, ownershipType: true, verificationStatus: true, user: { select: { email: true, name: true, phone: true } }, _count: { select: { kos: true } } },
    })
    console.table(
      rows.map((r) => ({
        since: r.memberSince.toISOString().slice(0, 10),
        email: r.user.email,
        name: r.user.name,
        phone: r.user.phone,
        ownershipType: r.ownershipType,
        status: r.verificationStatus,
        kos: r._count.kos,
      })),
    )
  } else if (first === 'revoke' && second) {
    const res = await prisma.ownerProfile.updateMany({ where: { user: { email: second.toLowerCase() } }, data: { approvedAt: null, verificationStatus: 'BELUM_KIRIM', verificationReason: null } })
    console.log(res.count ? `Hidden: ${second}` : `No owner with email ${second}`)
  } else if (first && first.includes('@')) {
    const email = first.toLowerCase()
    const res = await prisma.ownerProfile.updateMany({
      where: { user: { email }, verificationStatus: { not: 'DISETUJUI' } },
      data: { verificationStatus: 'DISETUJUI', verificationReason: null, approvedAt: new Date() },
    })
    console.log(res.count ? `Approved: ${first}` : `Nothing to approve for ${first} (unknown email, or already approved)`)
  } else {
    console.error('Usage: list | <email> | revoke <email>')
    process.exitCode = 2
  }
} finally {
  await prisma.$disconnect()
}
