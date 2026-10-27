// Operator tool: go back to an earlier catalogue version by loading its file again.
//
//   npm run catalog:rollback -w backend -- list
//   npm run catalog:rollback -w backend -- <regions|places|campuses> <file-of-the-earlier-version>
//
// The importer is idempotent and removes rows of any other version, so the result is exactly the earlier file. Keep the previous
// `*.csv.gz` next to the new one (Bryan's rule: never delete a loaded version's file until the next one has been checked).
import '../src/env.ts'
import { createPrisma } from '../src/db/client.ts'
import { requireEnv } from '../src/env.ts'
import { rollbackTo } from './catalog/import.ts'
import type { Dataset } from './catalog/import.ts'

const [first, file] = process.argv.slice(2)
const prisma = createPrisma(requireEnv('DATABASE_URL'))
try {
  if (first === 'list') {
    console.table((await prisma.catalogMeta.findMany({ orderBy: { loadedAt: 'desc' }, take: 30 })).map((m) => ({ version: m.version, status: m.status, rows: m.rowCount, loadedAt: m.loadedAt.toISOString() })))
  } else if ((first === 'regions' || first === 'places' || first === 'campuses') && file) {
    console.log(JSON.stringify(await rollbackTo(prisma, first as Dataset, file, console.log)))
  } else {
    console.error('Usage: list | <regions|places|campuses> <file>')
    process.exitCode = 2
  }
} finally {
  await prisma.$disconnect()
}
