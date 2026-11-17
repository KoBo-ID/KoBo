// Operator tool: moderate places that owners added ("Tambah tempat"). They stay invisible to the public until approved.
//
//   npm run places:approve -w backend -- list                 (pending, oldest first)
//   npm run places:approve -w backend -- approve <id>          (shows on the kos; its snapshot is rebuilt)
//   npm run places:approve -w backend -- reject <id>
//
// Before approving: the name must be a real place near the kos, with no phone number, link or personal name.
import '../src/env.ts'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'
import { attachPlaces } from '../src/placeCatalog.ts'

const [cmd, id] = process.argv.slice(2)
const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  if (cmd === 'list') {
    const rows = await prisma.ownerPlace.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, include: { kos: { select: { name: true, city: true } } } })
    console.table(rows.map((r) => ({ id: r.id, since: r.createdAt.toISOString().slice(0, 10), kos: `${r.kos.name} (${r.kos.city})`, category: r.category, name: r.name, note: r.note })))
  } else if ((cmd === 'approve' || cmd === 'reject') && id) {
    const row = await prisma.ownerPlace.findUnique({ where: { id } })
    if (!row || row.status !== 'pending') {
      console.log(`Tidak ada tempat pending dengan id ${id}`)
      process.exitCode = 1
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.ownerPlace.update({ where: { id }, data: { status: cmd === 'approve' ? 'approved' : 'rejected' } })
        if (cmd === 'approve') await attachPlaces(tx, row.kosId)
      })
      console.log(`${cmd === 'approve' ? 'Disetujui' : 'Ditolak'}: ${row.name}`)
    }
  } else {
    console.error('Usage: list | approve <id> | reject <id>')
    process.exitCode = 2
  }
} finally {
  await prisma.$disconnect()
}
