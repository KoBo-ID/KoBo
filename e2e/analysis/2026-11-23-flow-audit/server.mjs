// Isolated Flow Audit server launcher (port 3110, DB kobo_e2e_flow_audit).
// NEVER points at dev (:5434/kobo) or main e2e (:5433/kobo_e2e).
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const backend = `${root}backend`

const port = process.env.AUDIT_PORT ?? '3110'
const dbUrl = process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@127.0.0.1:5433/kobo_e2e_flow_audit'

if (!dbUrl.includes('kobo_e2e_flow_audit')) {
  console.error(`[AUDIT GUARD] Refusing to start with non-isolated DATABASE_URL: ${dbUrl}`)
  process.exit(2)
}
if (dbUrl.includes(':5434/') || dbUrl.endsWith('/kobo') || dbUrl.endsWith('/kobo_e2e')) {
  console.error(`[AUDIT GUARD] Refusing to touch protected database: ${dbUrl}`)
  process.exit(2)
}

const env = {
  ...process.env,
  NODE_ENV: 'production',
  ALLOW_FAKE_STORAGE: '1',
  PORT: port,
  BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
  ALLOW_INSECURE_AUTH_URL: '1',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'audit-secret-audit-secret-audit-secret-0123456789',
  PAYMENT_PROVIDER: 'mock',
  ALLOW_MOCK_PAYMENTS: '1',
  PAYMENT_RETURN_ORIGIN: '',
  ALLOW_E2E_HOOKS: '1',
  DEMO_ISOLATION: process.env.AUDIT_DEMO_ISOLATION ?? '1',
  DATABASE_URL: dbUrl,
  RESEND_API_KEY: '',
  ALLOW_CONSOLE_EMAIL: '1',
  GEOCODER: 'off',
  REQUIRE_PROFILE_CONSENTS: process.env.AUDIT_REQUIRE_CONSENTS ?? '1',
  REQUIRE_STUDENT_VERIFICATION: process.env.AUDIT_REQUIRE_STUDENT ?? '1',
  // Ensure auto-review switches stay off so verification states are tested accurately
  KTM_AUTO_REVIEW_SECONDS: '',
  OWNER_AUTO_REVIEW_SECONDS: '',
}

const tsxCli = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url))
const prismaCli = fileURLToPath(new URL('../../../node_modules/prisma/build/index.js', import.meta.url))
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: backend, env, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run(process.execPath, [prismaCli, 'migrate', 'deploy'])
if (process.env.AUDIT_SKIP_SEED !== '1') {
  run(process.execPath, [tsxCli, 'src/db/seedCli.ts'])
}

const child = spawn(process.execPath, ['src/index.ts'], { cwd: backend, env, stdio: 'inherit' })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('exit', (code) => process.exit(code ?? 0))
