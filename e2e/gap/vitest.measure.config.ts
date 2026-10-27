// Same as backend/vitest.config.ts plus the instrumentation setup file. Run from backend/: vitest run --config ../e2e/gap/vitest.measure.config.ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('../../backend', import.meta.url)),
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: [fileURLToPath(new URL('./backend-instrument.setup.ts', import.meta.url))],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: { BETTER_AUTH_URL: 'http://localhost:3000', BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789' },
  },
})
