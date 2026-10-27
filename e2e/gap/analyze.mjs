// Per-procedure outcome counts from a proxy log (and optionally a backend-instrumentation log).
// Usage: node e2e/gap/analyze.mjs <proxy.jsonl> [backend.jsonl] > out.csv
import fs from 'node:fs'
const procs = fs.readFileSync('notes/gap-tests/inventory/procedures.csv', 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split(',')[0])
const stats = Object.fromEntries(procs.map((p) => [p, { ok: 0, denied: 0, invalid: 0, other: 0 }]))
const bucket = (status) => (status < 300 ? 'ok' : status === 401 || status === 403 ? 'denied' : status === 400 ? 'invalid' : 'other')
const lines = (f) => (f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
for (const e of lines(process.argv[2])) {
  const m = e.path.match(/^\/api\/trpc\/([\w.]+)$/)
  if (m && stats[m[1]]) stats[m[1]][bucket(e.status)]++
}
for (const e of lines(process.argv[3])) if (stats[e.proc]) stats[e.proc][e.code === 'OK' ? 'ok' : e.code === 'UNAUTHORIZED' || e.code === 'FORBIDDEN' ? 'denied' : e.code === 'BAD_REQUEST' ? 'invalid' : 'other']++
console.log('procedure,success,denied (401/403),invalid-input (400),other errors')
for (const p of procs) console.log([p, stats[p].ok, stats[p].denied, stats[p].invalid, stats[p].other].join(','))
