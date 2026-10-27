// The unchanged old suite (../tests) run against the logging proxy on :3100; no webServer (e2e/gap/server.mjs + proxy.mjs are started by hand).
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '../tests',
  outputDir: '../test-results-gap',
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  workers: 4,
  reporter: [['list'], ['json', { outputFile: '../../notes/gap-tests/coverage/new-suite-results.json' }]],
  use: { baseURL: 'http://localhost:3100', trace: 'off', reducedMotion: 'reduce' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
