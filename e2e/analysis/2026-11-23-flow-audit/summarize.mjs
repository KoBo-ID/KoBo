import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve('notes/analysis/2026-11-23-flow-audit/evidence')
const csv = fs.readFileSync(path.join(dir, 'flow-telemetry.csv'), 'utf8').trim().split(/\r?\n/)
const header = csv[0].split(',')
const rows = csv.slice(1).map((line) => {
  const cols = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQ = !inQ
      }
      continue
    }
    if (ch === ',' && !inQ) {
      cols.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  cols.push(cur)
  return Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']))
})

const byStatus = {}
const lcps = []
const clss = []
const durs = []
for (const r of rows) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1
  if (r.lcp_ms) lcps.push(Number(r.lcp_ms))
  if (r.cls_score) clss.push(Number(r.cls_score))
  if (r.duration_ms) durs.push(Number(r.duration_ms))
}
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null
}
const summary = {
  total_cases_recorded: rows.length,
  by_status: byStatus,
  duration_ms: { median: pct(durs, 0.5), p95: pct(durs, 0.95) },
  lcp_ms: { median: pct(lcps, 0.5), p95: pct(lcps, 0.95), max: Math.max(...lcps) },
  cls_score: { median: pct(clss, 0.5), max: Math.max(...clss) },
  total_console_errors: rows.reduce((a, r) => a + Number(r.console_error_count || 0), 0),
  total_page_errors: rows.reduce((a, r) => a + Number(r.page_error_count || 0), 0),
  total_unexpected_http_errors: rows.reduce((a, r) => a + Number(r.unexpected_http_4xx_5xx_count || 0), 0),
  max_overflow_px: Math.max(...rows.map((r) => Number(r.horizontal_overflow_px || 0))),
  total_nested_interactive: rows.reduce((a, r) => a + Number(r.nested_interactive_count || 0), 0),
}
fs.writeFileSync(path.join(dir, 'playwright-results.json'), JSON.stringify({ summary, rows }, null, 2))
console.log(JSON.stringify(summary, null, 2))
