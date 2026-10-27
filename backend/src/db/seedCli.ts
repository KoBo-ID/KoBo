import '../env.ts'
import { requireEnv } from '../env.ts'
import { createPrisma } from './client.ts'
import { attachPlaces, stampKosRegion } from '../placeCatalog.ts'
import { resetDb } from './seed.ts'

const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  const t = Date.now()
  await resetDb(prisma)
  console.log(`seeded in ${Date.now() - t} ms`)
  // With the location catalogue loaded (catalog:import), give every seeded kos its region and nearby snapshot.
  if ((await prisma.region.count()) > 0) {
    const kos = await prisma.kos.findMany({ select: { id: true, lat: true, lng: true } })
    for (const k of kos) {
      await stampKosRegion(prisma, k.id, { lat: k.lat, lng: k.lng })
      await prisma.$transaction((tx) => attachPlaces(tx, k.id))
    }
    console.log(`located ${kos.length} kos from the catalogue`)
  }
} finally {
  await prisma.$disconnect()
}
