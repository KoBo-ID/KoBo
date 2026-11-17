// Operator tool: load the cleaned location catalogue into the database. A one-off job, never run inside the api container
// (mem_limit 384m): run it from your machine against the target DATABASE_URL, or as `docker compose run --rm` on the VPS.
//
//   npm run catalog:import -w backend -- regions   <file> [--dry-run]
//   npm run catalog:import -w backend -- places    <file> [--dry-run]
//   npm run catalog:import -w backend -- campuses  <file> [--dry-run]
//   npm run catalog:import -w backend -- all [dir] [--dry-run]    (regions, campuses, then places; default dir backend/data/catalog)
//
// Files are `.csv` or `.csv.gz` made by notes/data-gathering/scripts. A `<file>.sha256` or sibling `*.meta.json` is not required; pass
// --sha256=<hex> to pin the checksum. Order matters for `all`: regions first, because places and campuses refer to region codes.
import '../src/env.ts'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'
import { CatalogImportError, importCampuses, importPlaces, importRegions } from './catalog/import.ts'
import type { ImportSummary } from './catalog/import.ts'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))
const dryRun = flags.has('--dry-run')
const sha = args.find((a) => a.startsWith('--sha256='))?.slice('--sha256='.length)
const [what, target] = positional

const log = (l: string) => console.log(l)
const prisma = createPrisma(requireEnv('DATABASE_URL'))

/** Every file that starts with the prefix (one per source for places), the newest name last. */
function pick(dir: string, prefix: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.startsWith(prefix) && /\.csv(\.gz)?$/.test(f)).sort().map((f) => join(dir, f))
}

async function run(): Promise<ImportSummary[]> {
  const opts = { dryRun, expectedSha256: sha, log }
  if (what === 'regions' && target) return [await importRegions(prisma, { ...opts, file: target })]
  if (what === 'places' && target) return [await importPlaces(prisma, { ...opts, file: target })]
  if (what === 'campuses' && target) return [await importCampuses(prisma, { ...opts, file: target })]
  if (what === 'all') {
    const dir = target ?? join(import.meta.dirname, '..', 'data', 'catalog')
    const out: ImportSummary[] = []
    for (const [name, fn] of [['region', importRegions], ['campus', importCampuses], ['places', importPlaces]] as const) {
      const files = pick(dir, name)
      for (const file of files) out.push(await fn(prisma, { ...opts, file }))
      if (files.length === 0) log(`(lewati ${name}: tidak ada file di ${dir})`)
    }
    return out
  }
  console.error('Usage: regions|places|campuses <file> [--dry-run] [--sha256=<hex>]  |  all [dir] [--dry-run]')
  process.exitCode = 2
  return []
}

try {
  const results = await run()
  for (const r of results) console.log(JSON.stringify(r))
} catch (e) {
  if (e instanceof CatalogImportError) {
    console.error(`GAGAL: ${e.message}`)
    process.exitCode = 1
  } else throw e
} finally {
  await prisma.$disconnect()
}
