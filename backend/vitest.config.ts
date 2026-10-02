import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    globalSetup: ['tests/globalSetup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Auth needs a base URL and secret; real values come from .env / the container in dev and prod.
    env: {
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
      PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
    },
  },
})
