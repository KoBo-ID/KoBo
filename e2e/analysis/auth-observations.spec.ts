import { test, expect } from '@playwright/test'
import { ownIp } from '../tests/accounts'
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => ['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await ownIp(page)
})
test('B4 local unconfigured Google and failure fallback', async ({page}) => {
  await page.goto('/masuk')
  await page.getByRole('button',{name:'Lanjutkan dengan Google'}).click()
  await expect(page.getByRole('alert')).toContainText('Masuk dengan Google belum tersedia saat ini.')
  await page.goto('/masuk?google=gagal')
  await expect(page.getByRole('alert')).toContainText('Masuk dengan Google belum berhasil. Silakan coba lagi.')
})
test('B2 unknown login', async ({page}) => {
  await page.goto('/masuk')
  await page.getByLabel('Email').fill('tidak-ada@example.com')
  await page.getByLabel('Kata Sandi').fill('salah-salah-1')
  await page.getByRole('button',{name:'Masuk ke Akun'}).click()
  await expect(page.getByRole('alert')).toContainText('Email atau kata sandi salah')
})
test('B6 student guard and signout', async ({page}) => {
  await page.goto('/owner/dashboard')
  await expect(page).toHaveURL(/\/masuk\?peran=pemilik&next=/)
  await page.goto('/masuk')
  await page.getByRole('button',{name:'Masuk sebagai Mahasiswa'}).click()
  await page.goto('/owner/dashboard')
  await expect(page).toHaveURL(/\/owner\/login/)
  await page.goto('/')
  await page.getByRole('button',{name:'Menu Pengguna'}).click()
  await page.getByRole('button',{name:'Keluar'}).click()
  await page.reload()
  await expect(page.getByRole('button',{name:'Masuk',exact:true})).toBeVisible()
})
