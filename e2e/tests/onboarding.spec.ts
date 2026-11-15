import { test, expect, loginAs } from './fixtures'
import { outboxCount, outboxLink, ownIp, signUpVerified } from './accounts'

test('unknown URL shows the Indonesian 404 with a link home', async ({ page }) => {
  await page.goto('/halaman-yang-tidak-ada')
  await expect(page.getByRole('heading', { name: 'Halaman tidak ditemukan' })).toBeVisible()
  await page.getByRole('link', { name: 'Kembali ke Beranda' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('sign-up shows the "cek email" state and the emailed link confirms verification', async ({ page }) => {
  await ownIp(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  const dialog = page.locator('main')
  await dialog.getByRole('button', { name: 'Daftar baru' }).click()
  const email = `daftar-${Date.now()}@example.com`
  await dialog.getByLabel('Nama Lengkap').fill('Calon Penyewa')
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByLabel('Kata Sandi').fill('Sandi-rahasia-123')
  await dialog.getByLabel(/Saya menyetujui/).check()
  await dialog.getByRole('button', { name: 'Daftar Sekarang' }).click()
  await expect(dialog.getByText('Cek email Anda').first()).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Kirim ulang email verifikasi' })).toBeVisible()

  await page.goto(await outboxLink(email, 'verify-email'))
  await expect(page).toHaveURL(/\/verifikasi-email/)
  await expect(page.getByRole('heading', { name: 'Email berhasil diverifikasi' })).toBeVisible()
})

test('"Kirim ulang email verifikasi" queues a fresh link that verifies the account', async ({ page }) => {
  await ownIp(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  const dialog = page.locator('main')
  await dialog.getByRole('button', { name: 'Daftar baru' }).click()
  const email = `ulang-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await dialog.getByLabel('Nama Lengkap').fill('Calon Penyewa')
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByLabel('Kata Sandi').fill('Sandi-rahasia-123')
  await dialog.getByLabel(/Saya menyetujui/).check()
  await dialog.getByRole('button', { name: 'Daftar Sekarang' }).click()
  await expect(dialog.getByText('Cek email Anda').first()).toBeVisible()
  const firstLink = await outboxLink(email, 'verify-email')

  // The verification link is a token with second-resolution timestamps: a resend inside the same second is the same link.
  await page.waitForTimeout(1100)
  await dialog.getByRole('button', { name: 'Kirim ulang email verifikasi' }).click()
  await expect(dialog.getByText('Tautan verifikasi dikirim ulang.', { exact: false })).toBeVisible()
  await expect.poll(() => outboxCount(email, 'verify-email')).toBe(2)
  const latest = await outboxLink(email, 'verify-email')
  expect(latest).not.toBe(firstLink)

  await page.goto(latest)
  await expect(page).toHaveURL(/\/verifikasi-email/)
  await expect(page.getByRole('heading', { name: 'Email berhasil diverifikasi' })).toBeVisible()
})

test('a bad verification link says so in Indonesian', async ({ page }) => {
  await page.goto('/verifikasi-email?error=invalid_token')
  await expect(page.getByRole('heading', { name: 'Verifikasi gagal' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kirim Ulang Email Verifikasi' })).toBeVisible()
})

test('forgot password shows a confirmation, and the emailed link sets a new password', async ({ page }) => {
  const email = await signUpVerified(page, 'lupa')
  await page.context().clearCookies()
  await ownIp(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  const dialog = page.locator('main')
  await dialog.getByRole('button', { name: 'Lupa kata sandi?' }).click()
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByRole('button', { name: 'Kirim Tautan Atur Ulang' }).click()
  await expect(dialog.getByText(/telah mengirim tautan untuk mengatur ulang/)).toBeVisible()

  await page.goto(await outboxLink(email, 'reset-password'))
  await expect(page).toHaveURL(/\/reset-password\?token=/)
  await page.getByLabel('Kata Sandi Baru', { exact: true }).fill('Sandi-baru-456')
  await page.getByLabel('Ulangi Kata Sandi Baru').fill('Sandi-baru-456')
  await page.getByRole('button', { name: 'Simpan Kata Sandi Baru' }).click()
  await expect(page.getByRole('heading', { name: 'Kata sandi diperbarui' })).toBeVisible()
})

test('the reset page rejects a missing token', async ({ page }) => {
  await page.goto('/reset-password')
  await expect(page.getByRole('heading', { name: 'Tautan tidak valid' })).toBeVisible()
})

test('campus-email form shows for a real student and rejects a non-.ac.id address', async ({ page, problems }) => {
  await signUpVerified(page, 'kampus')
  await page.goto('/profile')
  await expect(page.getByLabel('Email Kampus')).toBeVisible()
  await page.getByLabel('Email Kampus').fill('budi@gmail.com')
  await page.getByRole('button', { name: 'Kirim Tautan Verifikasi' }).click()
  await expect(page.getByRole('alert')).toContainText('.ac.id')
  // The browser logs the 400 as a console error; it is the expected outcome here.
  expect(problems.filter((p) => p.includes('400'))).toHaveLength(1)
  problems.splice(0)
})

test('campus-email link verifies the student and the profile shows it', async ({ page }) => {
  await signUpVerified(page, 'kampus2')
  await page.goto('/profile')
  const campus = `mhs-${Date.now()}@student.binus.ac.id`
  await page.getByLabel('Email Kampus').fill(campus)
  await page.getByRole('button', { name: 'Kirim Tautan Verifikasi' }).click()
  await expect(page.getByText(`Tautan verifikasi terkirim ke ${campus}`)).toBeVisible()
  await page.goto(await outboxLink(campus, 'campus-email'))
  await expect(page).toHaveURL(/\/profile\?campus=verified/)
  await expect(page.getByText('Email kampus terverifikasi').first()).toBeVisible()
})

test('an invalid campus link shows an error on the profile form', async ({ page }) => {
  await signUpVerified(page, 'kampus3')
  await page.goto('/profile?campus=invalid')
  await expect(page.getByRole('alert')).toContainText('tidak valid')
})

test('the demo student has no campus form (pre-verified)', async ({ page }) => {
  await loginAs(page, 'student')
  await page.goto('/profile')
  await expect(page.getByText('Email kampus terverifikasi').first()).toBeVisible()
  await expect(page.getByLabel('Email Kampus')).toHaveCount(0)
})

test('a new user can register as an owner and reach the dashboard', async ({ page }) => {
  await signUpVerified(page, 'pemilik')
  await page.goto('/owner/login')
  await page.getByRole('button', { name: 'Daftarkan diri sebagai pemilik' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nomor WhatsApp').fill('abc')
  await dialog.getByRole('button', { name: 'Daftar sebagai pemilik' }).click()
  await expect(dialog.getByText('Isi nomor WhatsApp dengan angka')).toBeVisible()
  await dialog.getByLabel('Nomor WhatsApp').fill('0812 3456 7890')
  await dialog.getByRole('button', { name: 'Daftar sebagai pemilik' }).click()
  await expect(page).toHaveURL(/\/owner\/dashboard$/)
  // A new owner can set everything up while the account waits for KoBo's approval.
  await expect(page.getByText('Akun pemilik Anda sedang diperiksa KoBo.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Papan okupansi', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Belum ada kos' })).toBeVisible()
})
