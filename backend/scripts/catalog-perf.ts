// Dev tool, NOT CI: timing of the catalogue queries against a database loaded with a large catalogue (scratch database only).
//
//   DATABASE_URL=postgresql://...scratch... npm run catalog:perf -w backend
//
// Prints p50/p95 over 200 calls each for placesNear, regionLookup (distinct points, cache cold), campus.search and kos.search by regionCode,
// and the process memory after the run. Refuses to run against a database that looks like the app's (name contains "kobo" but not "scratch").
import '../src/env.ts'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'
import { placesNear } from '../src/placeCatalog.ts'
import { clearRegionCache, regionLookup } from '../src/regionLookup.ts'
import { campusRouter } from '../src/trpc/location.ts'
import { kosRouter } from '../src/trpc/kos.ts'
import { createCallerFactory } from '../src/trpc/trpc.ts'

const url = requireEnv('DATABASE_URL')
if (!/scratch/.test(url)) {
  console.error('Refusing to run: DATABASE_URL must point at a scratch database (name contains "scratch").')
  process.exit(2)
}
const prisma = createPrisma(url)
const N = 200
const stats = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b)
  return { p50: +s[Math.floor(s.length * 0.5)]!.toFixed(1), p95: +s[Math.floor(s.length * 0.95)]!.toFixed(1), max: +s.at(-1)!.toFixed(1) }
}
async function time<T>(label: string, make: (i: number) => Promise<T>): Promise<void> {
  const ms: number[] = []
  for (let i = 0; i < N; i++) {
    const t = performance.now()
    await make(i)
    ms.push(performance.now() - t)
  }
  console.log(label.padEnd(34), JSON.stringify(stats(ms)))
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
// Dense box (Jabodetabek) for the places and region lookups.
const dense = () => ({ lat: rnd(-6.45, -5.95), lng: rnd(106.5, 107.2) })

try {
  const ctx = { prisma } as never
  const campus = createCallerFactory(campusRouter)(ctx)
  const kos = createCallerFactory(kosRouter)({ prisma, storage: { publicUrl: () => '' }, getSession: async () => null } as never)
  const codes = (await prisma.$queryRaw<{ code: string }[]>`SELECT code FROM "Region" WHERE level = 3 ORDER BY random() LIMIT ${N}`).map((r) => r.code)
  await time('placesNear (14 categories)', () => placesNear(prisma, dense()))
  clearRegionCache()
  await time('regionLookup (cold)', () => regionLookup(prisma, dense()))
  await time('campus.search "universitas"', () => campus.search({ q: 'universitas', limit: 10 }))
  await time('campus.search "binus"', () => campus.search({ q: 'binus', limit: 10 }))
  await time('kos.search regionCode (kecamatan)', (i) => kos.search({ regionCode: codes[i % codes.length]! }))
  console.log('rss MB', Math.round(process.memoryUsage().rss / 1048576), 'heapUsed MB', Math.round(process.memoryUsage().heapUsed / 1048576))
} finally {
  await prisma.$disconnect()
}
