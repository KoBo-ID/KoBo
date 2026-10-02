import '../env.ts'
import { requireEnv } from '../env.ts'
import { createPrisma } from './client.ts'
import { resetDb } from './seed.ts'

const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  const t = Date.now()
  await resetDb(prisma)
  console.log(`seeded in ${Date.now() - t} ms`)
} finally {
  await prisma.$disconnect()
}
