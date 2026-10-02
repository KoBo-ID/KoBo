import { test, expect } from './fixtures'
import { ownIp } from './accounts'

// Every UI sign-in goes through better-auth's per-IP limiter; without its own address each test would share one bucket.
test.beforeEach(({ page }) => ownIp(page))

test('demo owner button signs in and lands on the owner dashboard @postdeploy', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Masuk sebagai Demo Mahasiswa' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Masuk sebagai Demo Pemilik' }).click()
  await expect(page).toHaveURL(/\/owner\/dashboard$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Mitra Pemilik Aktif')).toBeVisible()
})

test('demo student signs in, sees their account in the navbar, and can sign out', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('button', { name: 'Masuk sebagai Demo Mahasiswa' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: 'Menu Pengguna' }).click()
  await expect(page.getByText('Demo Mahasiswa', { exact: true })).toBeVisible()
  await expect(page.getByText('Mahasiswa Terverifikasi')).toBeVisible()
  await page.getByRole('button', { name: 'Keluar' }).click()
  await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeVisible()

  // The session is really gone server-side: a reload stays signed out.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeVisible()
})

for (const route of ['/owner/dashboard', '/owner/kos', '/owner/reviews']) {
  test(`${route} redirects home and opens the sign-in dialog when signed out`, async ({ page }) => {
    await page.goto(route)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Masuk sebagai Demo Pemilik' })).toBeVisible()
  })
}

test('a student session cannot enter the owner workspace', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await page.getByRole('button', { name: 'Masuk sebagai Demo Mahasiswa' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/owner/dashboard')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('wrong password shows an inline Indonesian error', async ({ page, problems }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Email').fill('tidak-ada@example.com')
  await dialog.getByLabel('Kata Sandi').fill('salah-salah-1')
  await dialog.getByRole('button', { name: 'Masuk ke Akun' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Email atau kata sandi salah')
  // The browser logs the 401 as a console error; it is the expected outcome here, so drain it.
  expect(problems.filter((p) => p.includes('401'))).toHaveLength(1)
  problems.splice(0)
})
