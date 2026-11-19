// Runs the new gap tests once per injected fault and records which probes were killed (at least one new test fails).
// Usage (repo root, e2e database + test database env set): node e2e/gap/mutations/run.mjs [e2e|backend|all|selftest]
// A probe ends in one of three states: KILLED (a test failed), SURVIVED (tests ran and all passed) or ERROR (the runner crashed, timed
// out, loaded no tests or failed to load a test file). ERROR is never a kill: it is counted separately and makes this script exit 1.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const TIMEOUT_MS = 20 * 60_000
// Backend probes run the gap-* integration tests unless listed here (the student gate has its own test files).
const BACKEND_TESTS = { B07: 'tests/integration/studentGate', B08: 'tests/integration/studentGate' }

const jsonFrom = (stdout, marker) => {
  const i = stdout.indexOf(marker)
  return JSON.parse(stdout.slice(i >= 0 ? i : stdout.indexOf('{')))
}
const crashed = (r) => (r.error ? `spawn: ${r.error.code ?? r.error.message}` : r.signal ? `killed by ${r.signal}` : null)

/** Vitest JSON reporter result -> { state, failing, note }. */
export function classifyVitest(r) {
  const c = crashed(r)
  if (c) return { state: 'ERROR', failing: [], note: c }
  let json
  try { json = jsonFrom(r.stdout ?? '', '{"numTotalTestSuites"') } catch (e) { return { state: 'ERROR', failing: [], note: 'no JSON: ' + String(e).slice(0, 80) } }
  if (!Array.isArray(json.testResults) || !(json.numTotalTests > 0)) return { state: 'ERROR', failing: [], note: 'no tests ran' }
  const loadFailed = json.testResults.filter((f) => f.status === 'failed' && (f.assertionResults ?? []).length === 0)
  if (loadFailed.length) return { state: 'ERROR', failing: [], note: 'test file failed to load: ' + String(loadFailed[0].message ?? loadFailed[0].name).slice(0, 80) }
  const failing = []
  for (const f of json.testResults) for (const t of f.assertionResults) if (t.status === 'failed') failing.push(t.title.slice(0, 60))
  if (r.status !== 0 && failing.length === 0) return { state: 'ERROR', failing: [], note: `exit ${r.status} without a failed test` }
  return { state: failing.length ? 'KILLED' : 'SURVIVED', failing, note: '' }
}

/** Playwright JSON reporter result -> { state, failing, note }. */
export function classifyPlaywright(r) {
  const c = crashed(r)
  if (c) return { state: 'ERROR', failing: [], note: c }
  let json
  try { json = jsonFrom(r.stdout ?? '', '{\n  "config"') } catch (e) { return { state: 'ERROR', failing: [], note: 'no JSON: ' + String(e).slice(0, 80) } }
  if (!Array.isArray(json.suites)) return { state: 'ERROR', failing: [], note: 'no suites in report' }
  if ((json.errors ?? []).length) return { state: 'ERROR', failing: [], note: 'runner errors: ' + String(json.errors[0].message ?? '').slice(0, 80) }
  const s = json.stats ?? {}
  if (!((s.expected ?? 0) + (s.unexpected ?? 0) + (s.flaky ?? 0) > 0)) return { state: 'ERROR', failing: [], note: 'no tests ran' }
  const failing = []
  const walk = (x) => { for (const t of x.specs ?? []) if (t.tests?.some((y) => y.results?.some((z) => z.status !== 'passed' && z.status !== 'skipped'))) failing.push(t.title.slice(0, 60)); (x.suites ?? []).forEach(walk) }
  json.suites.forEach(walk)
  return { state: failing.length ? 'KILLED' : 'SURVIVED', failing, note: '' }
}

function selftest() {
  const vt = (o) => ({ status: 0, stdout: '{"numTotalTestSuites":1,' + JSON.stringify(o).slice(1), ...o.__r })
  const ok = { numTotalTests: 2, testResults: [{ status: 'passed', assertionResults: [{ status: 'passed', title: 'a' }, { status: 'passed', title: 'b' }] }] }
  const bad = { numTotalTests: 2, testResults: [{ status: 'failed', assertionResults: [{ status: 'failed', title: 'a' }, { status: 'passed', title: 'b' }] }] }
  const cases = [
    ['vitest survived', classifyVitest(vt(ok)), 'SURVIVED'],
    ['vitest killed', classifyVitest({ ...vt(bad), status: 1 }), 'KILLED'],
    ['vitest crash signal', classifyVitest({ status: null, signal: 'SIGTERM', stdout: '' }), 'ERROR'],
    ['vitest timeout', classifyVitest({ status: null, error: { code: 'ETIMEDOUT' }, stdout: '' }), 'ERROR'],
    ['vitest no output', classifyVitest({ status: 1, stdout: 'boom' }), 'ERROR'],
    ['vitest zero tests', classifyVitest(vt({ numTotalTests: 0, testResults: [] })), 'ERROR'],
    ['vitest load failure', classifyVitest({ ...vt({ numTotalTests: 1, testResults: [{ status: 'failed', assertionResults: [], message: 'unknown FAULT' }] }), status: 1 }), 'ERROR'],
    ['vitest nonzero without failure', classifyVitest({ ...vt(ok), status: 1 }), 'ERROR'],
    ['pw killed', classifyPlaywright({ status: 1, stdout: JSON.stringify({ config: {}, suites: [{ specs: [{ title: 't', tests: [{ results: [{ status: 'failed' }] }] }] }], stats: { expected: 0, unexpected: 1 }, errors: [] }, null, 2) }), 'KILLED'],
    ['pw survived', classifyPlaywright({ status: 0, stdout: JSON.stringify({ config: {}, suites: [{ specs: [{ title: 't', tests: [{ results: [{ status: 'passed' }] }] }] }], stats: { expected: 1, unexpected: 0 }, errors: [] }, null, 2) }), 'SURVIVED'],
    ['pw server never started', classifyPlaywright({ status: 1, stdout: '', stderr: 'Error: Timed out waiting 120000ms from config.webServer' }), 'ERROR'],
    ['pw global errors', classifyPlaywright({ status: 1, stdout: JSON.stringify({ config: {}, suites: [], stats: { expected: 0, unexpected: 0 }, errors: [{ message: 'x' }] }, null, 2) }), 'ERROR'],
  ]
  let bad_ = 0
  for (const [name, got, want] of cases) { const okc = got.state === want; if (!okc) bad_++; console.log(okc ? 'ok  ' : 'FAIL', name, got.state, got.note) }
  process.exit(bad_ ? 1 : 0)
}

function main() {
  const which = process.argv[2] ?? 'all'
  if (which === 'selftest') return selftest()
  const out = 'notes/gap-tests/mutation-results.csv'
  const rows = ['probe,kind,what,killed,failing new tests,status']
  const counts = { KILLED: 0, SURVIVED: 0, ERROR: 0 }
  const run = (cmd, args, env, cwd) => spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS, shell: process.platform === 'win32' })
  const record = (id, kind, what, v) => {
    counts[v.state]++
    const failing = v.state === 'ERROR' ? ['(runner error: ' + v.note + ')'] : v.failing
    rows.push([id, kind, JSON.stringify(what), v.state === 'KILLED', JSON.stringify(failing.join(' | ')), v.state].join(','))
    console.log(id, v.state, v.state === 'ERROR' ? v.note : v.failing.length)
  }

  if (which === 'all' || which === 'e2e') {
    const e2eFaults = fs.readFileSync('e2e/gap/mutations/faults.ts', 'utf8').matchAll(/^  (F\d\d): \{ what: '([^']*)'/gm)
    const specs = ['gap-states', 'gap-owner', 'gap-a11y', 'gap-security']
    for (const [, id, what] of e2eFaults) {
      const r = run('npx', ['playwright', 'test', '-c', 'e2e/playwright.config.ts', ...specs, '--retries=0', '--reporter=json'], { FAULT: id }, '.')
      record(id, 'e2e', what, classifyPlaywright(r))
    }
  }
  if (which === 'all' || which === 'backend') {
    const src = fs.readFileSync('e2e/gap/mutations/backend-faults.setup.ts', 'utf8')
    for (const [, id, what] of src.matchAll(/^  (B\d\d): \{ what: '([^']*)'/gm)) {
      const r = run('node', ['../node_modules/vitest/vitest.mjs', 'run', '--config', '../e2e/gap/vitest.fault.config.ts', BACKEND_TESTS[id] ?? 'tests/integration/gap-', '--reporter=json'], { FAULT: id }, 'backend')
      record(id, 'backend', what, classifyVitest(r))
    }
  }
  fs.writeFileSync(out.replace('.csv', `.${which}.csv`), rows.join('\n') + '\n')
  console.log(`killed ${counts.KILLED}, survived ${counts.SURVIVED}, error ${counts.ERROR}`)
  if (counts.ERROR > 0) { console.error(`${counts.ERROR} probe(s) ended in ERROR (runner crash, timeout or setup failure); these are not kills`); process.exitCode = 1 }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
