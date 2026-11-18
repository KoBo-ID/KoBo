import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

let ipCounter = 0
/** A fresh fake client address per call: better-auth rate-limits by cf-connecting-ip, and all e2e traffic is otherwise one IP. */
export const uniqueIp = () => `10.77.${Math.floor(Math.random() * 250)}.${(ipCounter++ % 250) + 1}`

/** Latest queued email link for a recipient, read straight from the e2e database (polls briefly). */
export async function outboxLink(to: string, template: string): Promise<string> {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@localhost:5433/kobo_e2e' })
  await client.connect()
  try {
    for (let i = 0; i < 40; i++) {
      const r = await client.query('SELECT payload FROM "EmailOutbox" WHERE "to" = $1 AND template = $2 ORDER BY "createdAt" DESC LIMIT 1', [to, template])
      if (r.rows[0]) return (r.rows[0].payload as { url: string }).url
      await new Promise((res) => setTimeout(res, 250))
    }
  } finally {
    await client.end()
  }
  throw new Error(`no ${template} email queued for ${to}`)
}

/** Latest 6-digit code queued for a recipient (verify-email or campus-email), read straight from the e2e database (polls briefly). */
export async function outboxCode(to: string, template: string, notCode?: string): Promise<string> {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@localhost:5433/kobo_e2e' })
  await client.connect()
  try {
    for (let i = 0; i < 40; i++) {
      const r = await client.query('SELECT payload FROM "EmailOutbox" WHERE "to" = $1 AND template = $2 ORDER BY "createdAt" DESC LIMIT 1', [to, template])
      const code = (r.rows[0]?.payload as { code?: string } | undefined)?.code
      if (code && code !== notCode) return code
      await new Promise((res) => setTimeout(res, 250))
    }
  } finally {
    await client.end()
  }
  throw new Error(`no ${template} code queued for ${to}`)
}

/** Number of queued emails of one template for a recipient, read straight from the e2e database. */
export async function outboxCount(to: string, template: string): Promise<number> {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL ?? 'postgresql://kobo:kobo@localhost:5433/kobo_e2e' })
  await client.connect()
  try {
    const r = await client.query('SELECT count(*)::int AS n FROM "EmailOutbox" WHERE "to" = $1 AND template = $2', [to, template])
    return r.rows[0].n as number
  } finally {
    await client.end()
  }
}

/** Register a real (non-demo) student through the API and verify the email with the outbox code. The page ends up signed in. */
export async function signUpVerified(page: Page, label: string) {
  const baseURL = test.info().project.use.baseURL as string
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const headers = { origin: new URL(baseURL).origin, 'cf-connecting-ip': uniqueIp() }
  const up = await page.context().request.post('/api/auth/sign-up/email', { data: { name: 'Penguji E2E', email, password: 'Sandi-rahasia-123' }, headers })
  expect(up.ok(), 'sign-up').toBe(true)
  const otp = await outboxCode(email, 'verify-email')
  const verify = await page.context().request.post('/api/auth/email-otp/verify-email', { data: { email, otp }, headers })
  expect(verify.ok(), 'verify email code').toBe(true) // a correct code signs the user in (session cookie)
  return email
}

/** Give this page its own client address for /api/auth calls only (a context-wide header would break cross-origin font preflights). */
export async function ownIp(page: Page) {
  const ip = uniqueIp()
  await page.route('**/api/auth/**', (route) => route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }))
}
