import { execSync } from 'node:child_process'
import '../src/env.ts'

// Apply the real migration chain (incl. hand-written SQL) to the throwaway test database.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example; run `docker compose -f backend/docker-compose.yml up -d postgres-test`)')
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } })
}
