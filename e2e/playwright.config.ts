import { defineConfig, devices } from '@playwright/test'

// BASE_URL set  -> run against that deployment, no local server (post-deploy smoke).
// BASE_URL unset -> start the production server on E2E_PORT against the kobo_e2e database.
const baseURL = process.env.BASE_URL
const port = process.env.E2E_PORT ?? '3100'

export default defineConfig({
  testDir: './tests',
  // Sign-in flows chain several round trips, and the hero's WebGL scene makes parallel local runs CPU-bound.
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: baseURL ?? `http://localhost:${port}`,
    trace: 'on-first-retry',
    // The hero's WebGL scene (software-rendered in headless Chromium) saturates the CPU of every parallel worker, so
    // pages never settle and clicks/navigations time out. Reduced motion is a real gate in HeroScene: it renders the
    // static poster instead, which is what these functional tests want.
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: baseURL
    ? undefined
    : {
        command: 'node e2e/start-server.mjs',
        cwd: '..',
        url: `http://localhost:${port}/health`,
        timeout: 120_000,
        reuseExistingServer: false,
        stdout: 'pipe',
        stderr: 'pipe',
      },
})
