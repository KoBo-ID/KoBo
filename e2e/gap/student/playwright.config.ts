// Gap project: the server is started with REQUIRE_STUDENT_VERIFICATION=1 (the repo's e2e server forces 0), on its own port and its own
// database (kobo_e2e_student), so it can never truncate the database the main e2e run uses. Run it as its own gate:
//   E2E_DATABASE_URL=postgresql://kobo:kobo@127.0.0.1:5433/kobo_e2e_student npx playwright test -c e2e/gap/student/playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

const port = process.env.GAP_STUDENT_PORT ?? '3103'
const database = process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@127.0.0.1:5433/kobo_e2e_student'
if (!database.includes('kobo_e2e_student')) throw new Error('the student project must use its own database (kobo_e2e_student), not the main e2e database')

// The specs read the outbox and the tables through e2e/tests/seams.ts, which uses this variable.
process.env.E2E_DATABASE_URL = database

export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results-student',
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
    env: { GAP_SERVER_PORT: port, GAP_PUBLIC_URL: `http://localhost:${port}`, GAP_REQUIRE_STUDENT: '1', E2E_DATABASE_URL: database, E2E_PORT: port },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
