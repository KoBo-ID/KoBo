// Operator tool: the platform-wide "Kampus Mitra" list (students of these campuses get the kos discount).
//
//   npx tsx scripts/campus-affiliations.ts list
//   npx tsx scripts/campus-affiliations.ts add <campusId> "<label>"    (a parent campus also covers its branches)
//   npx tsx scripts/campus-affiliations.ts remove <campusId>           (sets active = false; the row stays)
import '../src/env.ts'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'

const [cmd, campusId, label] = process.argv.slice(2)
const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  if (cmd === 'list') {
    const rows = await prisma.campusAffiliation.findMany({ orderBy: { createdAt: 'asc' }, take: 500 })
    console.table(rows.map((r) => ({ campusId: r.campusId, label: r.label, active: r.active })))
  } else if (cmd === 'add' && campusId && label) {
    const campus = await prisma.campus.findUnique({ where: { id: campusId }, select: { id: true } })
    if (!campus) {
      console.error(`Campus ${campusId} not found.`)
      process.exitCode = 1
    } else {
      await prisma.campusAffiliation.upsert({ where: { campusId }, create: { campusId, label }, update: { label, active: true } })
      console.log(`Added ${campusId} (${label})`)
    }
  } else if (cmd === 'remove' && campusId) {
    const res = await prisma.campusAffiliation.updateMany({ where: { campusId }, data: { active: false } })
    if (res.count === 0) {
      console.error(`Campus ${campusId} is not on the list.`)
      process.exitCode = 1
    } else console.log(`Deactivated ${campusId}`)
  } else {
    console.error('Usage: list | add <campusId> "<label>" | remove <campusId>')
    process.exitCode = 2
  }
} finally {
  await prisma.$disconnect()
}
