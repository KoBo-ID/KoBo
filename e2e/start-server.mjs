// Playwright webServer entry: migrate + reseed the dedicated e2e DB, then run the
// production server (serves frontend/dist, so `npm run build` must have run).
// Never point E2E_DATABASE_URL at dev data: resetDb() truncates it.
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const backend = `${root}backend`
const env = {
  ...process.env,
  NODE_ENV: 'production',
  ALLOW_FAKE_STORAGE: '1', // e2e only: no R2 here, so opt in to the fake storage
  PORT: process.env.E2E_PORT ?? '3100',
  // Auth: the origin check compares requests against this, so it must be the URL the browser uses.
  BETTER_AUTH_URL: `http://localhost:${process.env.E2E_PORT ?? '3100'}`,
  ALLOW_INSECURE_AUTH_URL: '1', // e2e only: production mode normally refuses a non-https / localhost BETTER_AUTH_URL
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'e2e-secret-e2e-secret-e2e-secret-0123456789',
  PAYMENT_PROVIDER: 'mock',
  ALLOW_MOCK_PAYMENTS: '1', // e2e only: production mode normally refuses the mock provider
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@localhost:5433/kobo_e2e',
  // Never hit the real email service from e2e: backend/.env may hold a Resend key, and loadEnvFile
  // does not override keys that already exist, so an empty value forces the console transport.
  RESEND_API_KEY: '',
  // Never reach a public geocoder from e2e; specs stub place.search where they need a hit.
  GEOCODER: 'off',
}
const tsxCli = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))
const prismaCli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url))
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: backend, env, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run(process.execPath, [prismaCli, 'migrate', 'deploy'])
// seed imports @kobo/shared/domain (extensionless specifiers), so it needs tsx; the server itself runs on plain node.
run(process.execPath, [tsxCli, 'src/db/seedCli.ts'])

const child = spawn(process.execPath, ['src/index.ts'], { cwd: backend, env, stdio: 'inherit' })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('exit', (code) => process.exit(code ?? 0))
