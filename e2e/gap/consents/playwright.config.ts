// Gap project: the server is started with REQUIRE_PROFILE_CONSENTS=1 (the repo's e2e server forces 0), on its own port and its own
// database (kobo_e2e_consents), so it can never truncate the database the main e2e run uses. Run it as its own gate:
//   E2E_DATABASE_URL=postgresql://kobo:kobo@127.0.0.1:5433/kobo_e2e_consents npx playwright test -c e2e/gap/consents/playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

const port = process.env.GAP_CONSENTS_PORT ?? '3102'
const database = process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@127.0.0.1:5433/kobo_e2e_consents'
if (!database.includes('kobo_e2e_consents')) throw new Error('the consents project must use its own database (kobo_e2e_consents), not the main e2e database')

export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results-consents',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}`, reducedMotion: 'reduce', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/gap/server.mjs',
    cwd: '../../..',
    url: `http://localhost:${port}/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { GAP_SERVER_PORT: port, GAP_PUBLIC_URL: `http://localhost:${port}`, GAP_REQUIRE_CONSENTS: '1', E2E_DATABASE_URL: database, E2E_PORT: port },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
