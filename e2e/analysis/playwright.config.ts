import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1, retries: 0, timeout: 60000,
  outputDir: '../../notes/analysis/2026-10-27-workflow/artifacts/playwright',
  reporter: 'list', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3100', viewport: { width: 1280, height: 650 }, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off' },
})
