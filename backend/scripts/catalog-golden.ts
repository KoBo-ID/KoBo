// Operator/dev tool, NOT part of CI: run the golden addresses through regionLookup against a database that holds the real Region import.
//
//   DATABASE_URL=postgresql://...scratch... npm run catalog:golden -w backend -- ../notes/data-gathering/golden.csv
//
// Expected values in golden.csv come from the address text / public knowledge, never from the polygons under test. Prints one line per
// address and the pass rates for the dev and held-out splits (held-out rows must never be used to tune anything).
import '../src/env.ts'
import { readFileSync } from 'node:fs'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'
import { regionLookup, sameRegionName } from '../src/regionLookup.ts'
import { nearestCampuses } from '../src/placeCatalog.ts'
import { parseCsv } from './catalog/files.ts'

const file = process.argv[2]
if (!file) {
  console.error('Usage: catalog:golden <golden.csv>')
  process.exit(2)
}
const [head, ...body] = parseCsv(readFileSync(file, 'utf8'))
const rows = body.map((r) => Object.fromEntries(head!.map((c, i) => [c, r[i] ?? ''])))
const prisma = createPrisma(requireEnv('DATABASE_URL'))
const same = (a: string | undefined, b: string) => sameRegionName(a ?? '', b)

const tally: Record<string, { n: number; kab: number; kec: number; kelN: number; kel: number }> = {}
try {
  for (const r of rows) {
    const hit = await regionLookup(prisma, { lat: Number(r.lat), lng: Number(r.lng) })
    const kabOk = same(hit?.kabKota?.name, r.expected_kabkota!)
    const kecOk = same(hit?.kecamatan.name, r.expected_kecamatan!)
    const kelOk = r.expected_kelurahan ? same(hit?.desa?.name, r.expected_kelurahan) : null
    const campus = r.nearest_campus_expected ? (await nearestCampuses(prisma, { lat: Number(r.lat), lng: Number(r.lng) }, 3)).map((c) => c.id) : []
    const t = (tally[r.split!] ??= { n: 0, kab: 0, kec: 0, kelN: 0, kel: 0 })
    t.n++
    if (kabOk) t.kab++
    if (kecOk) t.kec++
    if (kelOk !== null) {
      t.kelN++
      if (kelOk) t.kel++
    }
    console.log(`${r.id}\t${r.split}\tkec ${kecOk ? 'OK ' : 'NO '}\tkab ${kabOk ? 'OK ' : 'NO '}\tkel ${kelOk === null ? '-  ' : kelOk ? 'OK ' : 'NO '}\tgot: ${hit?.kecamatan.name ?? '(none)'} / ${hit?.kabKota?.name ?? ''} / ${hit?.desa?.name ?? ''} [${hit?.confidence ?? ''}]\twant: ${r.expected_kecamatan} / ${r.expected_kabkota} / ${r.expected_kelurahan}${r.nearest_campus_expected ? `\tcampus ${campus.includes(r.nearest_campus_expected) ? 'OK' : 'NO'} ${campus.join(',')}` : ''}`)
  }
  for (const [split, t] of Object.entries(tally)) {
    console.log(`${split}: n=${t.n} kecamatan ${t.kec}/${t.n} (${((100 * t.kec) / t.n).toFixed(0)}%), kab/kota ${t.kab}/${t.n}, kelurahan ${t.kel}/${t.kelN}${t.kelN ? ` (${((100 * t.kel) / t.kelN).toFixed(0)}%)` : ''}`)
  }
} finally {
  await prisma.$disconnect()
}
