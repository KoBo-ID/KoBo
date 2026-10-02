// Bundle budget gate (spec §10). Run after `npm run build -w frontend`.
//
// Gzip method: node:zlib gzipSync at level 9, size in bytes / 1000.
// Rolldown's built-in Vite reporter (Rust) prints figures ~1.0-1.4 KB higher
// than this (e.g. building-*.js 138.67 reported vs 137.24 at level 9) and
// cannot be reproduced from node:zlib at any level (6 gives 137.71). The
// budgets in spec §10 (106.5 / 137.2 KB measured) were taken at level 9, so the
// gate uses level 9 to stay comparable with them. Treat the reporter's number
// as a slightly pessimistic upper bound.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync, constants } from 'node:zlib'

const dir = fileURLToPath(new URL('../frontend/dist/assets/', import.meta.url))
const budgets = [
  { prefix: 'index-', limitKB: 125 },
  { prefix: 'building-', limitKB: 140 },
]

let files
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.js'))
} catch {
  console.error(`bundle-gate: ${dir} not found. Run "npm run build -w frontend" first.`)
  process.exit(1)
}

let failed = false
for (const { prefix, limitKB } of budgets) {
  const matches = files.filter((f) => f.startsWith(prefix))
  if (matches.length !== 1) {
    console.error(`FAIL ${prefix}*.js: expected exactly 1 chunk, found ${matches.length}`)
    failed = true
    continue
  }
  const kb = gzipSync(readFileSync(dir + matches[0]), { level: constants.Z_BEST_COMPRESSION }).length / 1000
  const ok = kb <= limitKB
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${matches[0]}: ${kb.toFixed(2)} KB gzip (budget ${limitKB} KB)`)
  if (!ok) failed = true
}
if (failed) {
  console.error('bundle-gate: budget exceeded. Trim the initial bundle before merging.')
  process.exit(1)
}
