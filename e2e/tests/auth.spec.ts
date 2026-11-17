import { test, expect } from './fixtures'
import { ownIp } from './accounts'

// Every UI sign-in goes through better-auth's per-IP limiter; without its own address each test would share one bucket.
test.beforeEach(({ page }) => ownIp(page))

test('demo owner button signs in and lands on the owner dashboard @postdeploy', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  const dialog = page.locator('main')
  await expect(dialog.getByRole('button', { name: 'Masuk sebagai Mahasiswa' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Masuk sebagai Pemilik' }).click()
  await expect(page).toHaveURL(/\/owner\/dashboard$/)
  await expect(page).not.toHaveURL(/[/]masuk/)
  await expect(page.getByRole('heading', { level: 1, name: 'Papan okupansi' })).toBeVisible()
})

test('demo student signs in, sees their account in the navbar, and can sign out', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('button', { name: 'Masuk sebagai Mahasiswa' }).click()
  await expect(page).not.toHaveURL(/[/]masuk/)

  await page.getByRole('button', { name: 'Menu Pengguna' }).click()
  await expect(page.getByText('Dimas Pratama', { exact: true })).toBeVisible()
  await expect(page.getByText('Mahasiswa Terverifikasi')).toBeVisible()
  await page.getByRole('button', { name: 'Keluar' }).click()
  await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeVisible()

  // The session is really gone server-side: a reload stays signed out.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeVisible()
})

for (const route of ['/owner/dashboard', '/owner/kos', '/owner/reviews']) {
  test(`${route} redirects to the owner sign-in page and returns after login`, async ({ page }) => {
    await page.goto(route)
    await expect(page).toHaveURL(/\/masuk\?peran=pemilik&next=/)
    await expect(page.getByRole('button', { name: 'Pemilik kos' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Masuk sebagai Pemilik' }).click()
    await expect(page).toHaveURL(new RegExp(route + '$'))
  })
}

test('a student session cannot enter the owner workspace', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('button', { name: 'Masuk sebagai Mahasiswa' }).click()
  await expect(page).not.toHaveURL(/\/masuk/)
  await page.goto('/owner/dashboard')
  await expect(page).toHaveURL(/\/owner\/login$/)
})

test('wrong password shows an inline Indonesian error', async ({ page, problems }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  const dialog = page.locator('main')
  await dialog.getByLabel('Email').fill('tidak-ada@example.com')
  await dialog.getByLabel('Kata Sandi').fill('salah-salah-1')
  await dialog.getByRole('button', { name: 'Masuk ke Akun' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Email atau kata sandi salah')
  // The browser logs the 401 as a console error; it is the expected outcome here, so drain it.
  expect(problems.filter((p) => p.includes('401'))).toHaveLength(1)
  problems.splice(0)
})

for (const [label, open] of [
  ['dialog', async (page: import('@playwright/test').Page) => { await page.goto('/'); await page.getByRole('button', { name: 'Masuk', exact: true }).click() }],
  ['/masuk page', async (page: import('@playwright/test').Page) => { await page.goto('/masuk') }],
] as const) {
  test(`${label}: Google button is always there; unconfigured click shows a notice and starts no round trip`, async ({ page }) => {
    await page.route('**/api/trpc/auth.providers*', async (route) => {
      const res = await route.fetch()
      await route.fulfill({ response: res, body: (await res.text()).replace('"google":true', '"google":false') })
    })
    await open(page)
    const google = page.getByRole('button', { name: 'Lanjutkan dengan Google' })
    await expect(google).toBeVisible()
    let leftSite = false
    page.on('framenavigated', (f) => { if (f === page.mainFrame() && !f.url().includes('localhost')) leftSite = true })
    await google.click()
    await expect(page.getByRole('alert')).toContainText('Masuk dengan Google belum tersedia saat ini.')
    await expect(page.getByRole('button', { name: 'Masuk ke Akun' })).toBeVisible()
    expect(leftSite).toBe(false)
  })
}

test('/masuk role toggle keeps the typed email and honours ?peran and ?next', async ({ page }) => {
  await page.goto('/masuk?peran=pemilik&next=%2Fowner%2Fkos')
  await expect(page.getByRole('heading', { level: 1, name: 'Masuk ke Portal Pemilik Kos' })).toBeVisible()
  await page.getByLabel('Email').fill('ketik@example.com')
  await page.getByRole('button', { name: 'Pencari kos' }).click()
  await expect(page).toHaveURL(/next=%2Fowner%2Fkos/)
  await expect(page).not.toHaveURL(/peran=/)
  await expect(page.getByLabel('Email')).toHaveValue('ketik@example.com')
  await expect(page.getByRole('heading', { level: 1, name: 'Masuk ke Akun KoBo' })).toBeVisible()
})
