import { existsSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

// Prisma 7 does not load .env itself. backend/.env feeds both the CLI and the app.
if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx src/db/seedCli.ts' },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
})
