import { request as pwRequest } from '@playwright/test'
import { test, expect } from '../gap/fixtures'
import { uniqueIp } from './accounts'
import { expectHttpErrors, newContext, newOwnerWorld, newStudent, sql, trpcGet, trpcPost, trpcRaw, watch } from '../gap/helpers'

// Security and abuse behaviours that need the production-mode server (origin checks and rate limits are off under vitest).

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const PASSWORD = 'Sandi-rahasia-123'

test('[G-055][R-014] a sign-in with an external ?next= stays on the app origin', async ({ browser, problems }) => {
  const account = await newStudent(browser, { label: 'next-away' })
  try {
    for (const next of ['https://evil.example/phish', '//evil.example/phish']) {
      const visitor = await newContext(browser)
      watch(visitor.page, problems)
      await visitor.page.goto(`/masuk?next=${encodeURIComponent(next)}`)
      await visitor.page.getByLabel('Email').fill(account.email)
      await visitor.page.getByLabel('Kata Sandi').fill(PASSWORD)
      await visitor.page.getByRole('button', { name: 'Masuk ke Akun' }).click()
      await expect(visitor.page).not.toHaveURL(/\/masuk/)
      const here = new URL(visitor.page.url())
      expect(here.origin).toBe(new URL(test.info().project.use.baseURL as string).origin)
      await visitor.ctx.close()
    }
    expectHttpErrors(problems)
  } finally {
    await account.ctx.close()
  }
})

test('[G-041][R-107] a state-changing auth call with the session cookie but a foreign Origin is refused and keeps the session', async ({ browser }) => {
  const student = await newStudent(browser, { label: 'origin' })
  try {
    const me = () => trpcGet<{ user: { email: string } } | null>(student.ctx, 'auth.me')
    const baseOrigin = new URL(test.info().project.use.baseURL as string).origin
    expect((await me())?.user.email).toBe(student.email)

    const foreign = await student.ctx.request.post('/api/auth/sign-out', { data: {}, headers: { origin: 'https://evil.example', 'cf-connecting-ip': uniqueIp() } })
    expect(foreign.status()).toBeGreaterThanOrEqual(400)
    expect((await me())?.user.email).toBe(student.email)

    const own = await student.ctx.request.post('/api/auth/sign-out', { data: {}, headers: { origin: baseOrigin, 'cf-connecting-ip': uniqueIp() } })
    expect(own.ok()).toBe(true)
  } finally {
    await student.ctx.close()
  }
})

test('[G-056][R-068] a sixth kos is refused and the owner still has five', async ({ browser }) => {
  const owner = await newOwnerWorld(browser, { label: 'cap5', rooms: 1 })
  try {
    const input = (n: number) => ({
      name: `Kos Cap ${n}`, gender: 'CAMPUR', address: 'Jl. Cap', district: 'Kebayoran Baru', city: 'Jakarta Selatan', lat: -6.2, lng: 106.8,
      electricityType: 'INCLUDED', privateAmenities: [], sharedAmenities: [], studentDiscountAmount: 0,
    })
    for (let n = 2; n <= 5; n++) await trpcPost(owner.page, 'owner.kos.create', input(n))
    const sixth = await trpcRaw(owner.page, 'owner.kos.create', input(6))
    expect(sixth.status).toBeGreaterThanOrEqual(400)
    expect(sixth.message).toBeTruthy()
    expect(sixth.message).not.toMatch(/\b(error|limit|too many)\b/i)
    const [{ n }] = await sql<{ n: number }>('SELECT count(*)::int AS n FROM "Kos" WHERE "ownerId" = (SELECT id FROM "OwnerProfile" WHERE "userId" = $1)', [owner.userId])
    expect(n).toBe(5)
  } finally {
    await owner.ctx.close()
  }
})

test('[G-057][R-005] sign-up refuses a short password, a malformed email and a duplicate email, and creates no second account', async ({ browser, problems }) => {
  const existing = await newStudent(browser, { label: 'dup' })
  const visitor = await newContext(browser)
  const { page } = visitor
  watch(page, problems)
  try {
    await page.goto('/masuk')
    await page.getByRole('button', { name: 'Daftar baru' }).click()
    const form = page.locator('main')
    const fill = async (email: string, password: string) => {
      await form.getByLabel('Nama Lengkap').fill('Calon Penyewa')
      await form.getByLabel('Email').fill(email)
      await form.getByLabel('Kata Sandi').fill(password)
      const consent = form.getByLabel(/Saya menyetujui/)
      if (!(await consent.isChecked())) await consent.check()
      await form.getByRole('button', { name: 'Daftar Sekarang' }).click()
    }

    // The browser blocks a short password and a malformed address before anything is sent.
    await fill(`gap-short-${Date.now()}@example.com`, 'pendek')
    expect(await form.getByLabel('Kata Sandi').evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(true)
    await fill('bukan-email', PASSWORD)
    expect(await form.getByLabel('Email').evaluate((el: HTMLInputElement) => el.validity.typeMismatch)).toBe(true)
    await expect(form.getByText('Cek email Anda')).toHaveCount(0)

    // A duplicate address shows the same neutral screen as a new one (no account enumeration; documented in ADR 0017).
    await fill(existing.email, PASSWORD)
    await expect(form.getByText('Cek email Anda')).toBeVisible()
    await expect(form.getByRole('alert')).toHaveCount(0)
    expect(await sql('SELECT id FROM "User" WHERE email = $1', [existing.email])).toHaveLength(1)
    expect(await sql(`SELECT id FROM "User" WHERE email = 'bukan-email'`)).toHaveLength(0)

    // The server enforces the same limits when the form is bypassed.
    const headers = { origin: new URL(test.info().project.use.baseURL as string).origin, 'cf-connecting-ip': `10.66.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` }
    const short = await page.context().request.post('/api/auth/sign-up/email', { data: { name: 'X Y', email: `gap-api-short-${Date.now()}@example.com`, password: 'pendek' }, headers })
    expect(short.status()).toBeGreaterThanOrEqual(400)
    const bad = await page.context().request.post('/api/auth/sign-up/email', { data: { name: 'X Y', email: 'bukan-email', password: PASSWORD }, headers })
    expect(bad.status()).toBeGreaterThanOrEqual(400)
    expect(await sql(`SELECT id FROM "User" WHERE email LIKE 'gap-api-short-%'`)).toHaveLength(0)
    // F-002: the form caps the name at 80, and the server refuses a longer one when the form is bypassed.
    expect(await form.getByLabel('Nama Lengkap').getAttribute('maxlength')).toBe('80')
    const long = await page.context().request.post('/api/auth/sign-up/email', { data: { name: 'x'.repeat(81), email: `gap-api-long-${Date.now()}@example.com`, password: PASSWORD }, headers })
    expect(long.status()).toBe(400)
    expect((await long.json()).message).toBe('Nama terlalu panjang (maksimal 80 karakter).')
    expect(await sql(`SELECT id FROM "User" WHERE email LIKE 'gap-api-long-%'`)).toHaveLength(0)
    expect(problems.filter((p) => !/status of 4dd/.test(p))).toEqual([])
    problems.splice(0)
  } finally {
    await Promise.all([existing.ctx.close(), visitor.ctx.close()])
  }
})

test('[G-041][R-107] cookie-less sign-in and sign-up with a foreign Origin are refused; no Origin (curl) is allowed; the session cookie is SameSite Lax', async ({ browser, baseURL }) => {
  const account = await newStudent(browser, { label: 'origin' })
  const api = await pwRequest.newContext({ baseURL: baseURL! }) // no cookies
  const ip = () => ({ 'cf-connecting-ip': `10.67.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` })
  try {
    const creds = { email: account.email, password: PASSWORD }
    const evil = { origin: 'https://evil.example', ...ip() }
    expect((await api.post('/api/auth/sign-in/email', { data: creds, headers: evil })).status()).toBe(403)
    const upEmail = `gap-evil-${Date.now()}@example.com`
    expect((await api.post('/api/auth/sign-up/email', { data: { name: 'Evil', email: upEmail, password: PASSWORD }, headers: evil })).status()).toBe(403)
    expect(await sql('SELECT id FROM "User" WHERE email = $1', [upEmail])).toHaveLength(0)
    expect((await api.post('/api/auth/sign-in/email', { data: creds, headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', ...ip() } })).status()).toBe(403)

    // Neither Origin nor Referer (server-to-server, native client): allowed, as better-auth documents (decision recorded in decisions.md).
    const bare = await api.post('/api/auth/sign-in/email', { data: creds, headers: ip() })
    expect(bare.status()).toBe(200)

    // The session cookie of a browser sign-in is SameSite Lax (never None) and HttpOnly.
    const visitor = await newContext(browser)
    try {
      const res = await visitor.page.context().request.post('/api/auth/sign-in/email', { data: creds, headers: { origin: new URL(baseURL!).origin, ...ip() } })
      expect(res.status()).toBe(200)
      const session = (await visitor.page.context().cookies()).find((c) => /session_token/.test(c.name))
      expect(session?.sameSite).toBe('Lax')
      expect(session?.httpOnly).toBe(true)
    } finally {
      await visitor.ctx.close()
    }
  } finally {
    await api.dispose()
    await account.ctx.close()
  }
})
