import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // One file at a time in one child process at a time (the DB is shared). Pinned explicitly so a changed default or a
    // many-core host cannot spawn concurrent workers (Vitest 4 dropped poolOptions; maxWorkers replaces singleFork).
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    teardownTimeout: 30_000,
    globalSetup: ['tests/globalSetup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Auth needs a base URL and secret; real values come from .env / the container in dev and prod.
    env: {
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
    },
  },
})
