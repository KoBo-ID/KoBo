// Runs the new gap tests once per injected fault and records which probes were killed (at least one new test fails).
// Usage (repo root, e2e database + test database env set): node e2e/gap/mutations/run.mjs [e2e|backend|all]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const which = process.argv[2] ?? 'all'
const out = 'notes/gap-tests/mutation-results.csv'
const rows = ['probe,kind,what,killed,failing new tests']
const run = (cmd, args, env, cwd) => spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })

const e2eFaults = fs.readFileSync('e2e/gap/mutations/faults.ts', 'utf8').matchAll(/^  (F\d\d): \{ what: '([^']*)'/gm)
if (which === 'all' || which === 'e2e') {
  const specs = ['gap-states', 'gap-owner', 'gap-a11y', 'gap-security']
  for (const [, id, what] of e2eFaults) {
    const r = run('npx', ['playwright', 'test', '-c', 'e2e/playwright.config.ts', ...specs, '--retries=0', '--reporter=json'], { FAULT: id }, '.')
    let failing = []
    try {
      const json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
      const walk = (s) => { for (const t of s.specs ?? []) if (t.tests?.some((x) => x.results?.some((y) => y.status !== 'passed' && y.status !== 'skipped'))) failing.push(t.title.slice(0, 60)); (s.suites ?? []).forEach(walk) }
      json.suites.forEach(walk)
    } catch (e) { failing = ['(runner error: ' + String(e).slice(0, 80) + ')'] }
    rows.push([id, 'e2e', JSON.stringify(what), failing.length > 0, JSON.stringify(failing.join(' | '))].join(','))
    console.log(id, failing.length ? 'KILLED' : 'SURVIVED', failing.length)
  }
}
if (which === 'all' || which === 'backend') {
  const src = fs.readFileSync('e2e/gap/mutations/backend-faults.setup.ts', 'utf8')
  for (const [, id, what] of src.matchAll(/^  (B\d\d): \{ what: '([^']*)'/gm)) {
    const r = run('node', ['../node_modules/vitest/vitest.mjs', 'run', '--config', '../e2e/gap/vitest.fault.config.ts', 'tests/integration/gap-', '--reporter=json'], { FAULT: id }, 'backend')
    let failing = []
    try {
      const json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')))
      for (const f of json.testResults) for (const t of f.assertionResults) if (t.status === 'failed') failing.push(t.title.slice(0, 60))
    } catch (e) { failing = ['(runner error: ' + String(e).slice(0, 80) + ')'] }
    rows.push([id, 'backend', JSON.stringify(what), failing.length > 0, JSON.stringify(failing.join(' | '))].join(','))
    console.log(id, failing.length ? 'KILLED' : 'SURVIVED', failing.length)
  }
}
fs.writeFileSync(out.replace('.csv', `.${which}.csv`), rows.join('\n') + '\n')
