import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../..')
const port = process.env.AUDIT_PORT ?? '3110'
const dbUrl = process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@127.0.0.1:5433/kobo_e2e_flow_audit'
const resultsFile = path.join(
  repoRoot,
  'notes/analysis/2026-11-23-flow-audit/evidence',
  process.env.AUDIT_RESULTS_FILE ?? 'playwright-results.json',
)

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.audit\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: resultsFile }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 650 },
    trace: 'retain-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 650 } } }],
  webServer: {
    command: 'node e2e/analysis/2026-11-23-flow-audit/server.mjs',
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      AUDIT_PORT: port,
      E2E_DATABASE_URL: dbUrl,
      AUDIT_REQUIRE_STUDENT: process.env.AUDIT_REQUIRE_STUDENT ?? '1',
      AUDIT_REQUIRE_CONSENTS: process.env.AUDIT_REQUIRE_CONSENTS ?? '1',
      AUDIT_DEMO_ISOLATION: process.env.AUDIT_DEMO_ISOLATION ?? '1',
    },
  },
})
