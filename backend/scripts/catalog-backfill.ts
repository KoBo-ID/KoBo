// Operator tool: stamp region + nearby snapshot on existing kos, once the Region and PlaceCatalog tables are loaded.
//
//   npm run catalog:backfill -w backend              (only kos without a desaCode)
//   npm run catalog:backfill -w backend -- --all     (rebuild every kos, e.g. after a new catalogue version)
//
// The old per-kos text rows (Poi) are left alone: they carry no coordinates, so they cannot be matched to catalogue rows without
// guessing. kos.detail shows `nearby` when a snapshot exists and the Poi list otherwise.
import '../src/env.ts'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'
import { attachPlaces, stampKosRegion } from '../src/placeCatalog.ts'

const all = process.argv.includes('--all')
const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  const kos = await prisma.kos.findMany({ where: all ? {} : { desaCode: null }, select: { id: true, name: true, lat: true, lng: true }, orderBy: { id: 'asc' } })
  let located = 0
  let missed = 0
  for (const k of kos) {
    const r = await stampKosRegion(prisma, k.id, { lat: k.lat, lng: k.lng })
    if (r.desaCode) located++
    else missed++
    await prisma.$transaction((tx) => attachPlaces(tx, k.id))
  }
  console.log(`kos: ${kos.length}, dengan wilayah: ${located}, tanpa wilayah: ${missed}`)
} finally {
  await prisma.$disconnect()
}
