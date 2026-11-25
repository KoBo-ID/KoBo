import { test, expect, loginAs } from './fixtures'
import { outboxCode, outboxLink, ownIp, signUpVerified } from './accounts'

test('unknown URL shows the Indonesian 404 with a link home', async ({ page }) => {
  await page.goto('/halaman-yang-tidak-ada')
  await expect(page.getByRole('heading', { name: 'Halaman tidak ditemukan' })).toBeVisible()
  await page.getByRole('link', { name: 'Kembali ke Beranda' }).click()
  await expect(page).toHaveURL(/\/$/)
})

async function startSignUp(page: import('@playwright/test').Page, prefix: string) {
  await ownIp(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  const dialog = page.locator('main')
  await dialog.getByRole('button', { name: 'Daftar baru' }).click()
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await dialog.getByLabel('Nama Lengkap').fill('Calon Penyewa')
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByLabel('Kata Sandi', { exact: true }).fill('Sandi-rahasia-123')
  await dialog.getByLabel(/Saya menyetujui/).check()
  await dialog.getByRole('button', { name: 'Daftar Sekarang' }).click()
  await expect(dialog.getByText(`Masukkan kode 6 digit yang kami kirim ke ${email}. Berlaku 10 menit.`)).toBeVisible()
  return { dialog, email }
}

test('sign-up shows the code step; a wrong code is refused, the emailed code verifies and signs in', async ({ page, problems }) => {
  const { dialog, email } = await startSignUp(page, 'daftar')
  const input = dialog.getByLabel('Kode verifikasi')
  await expect(input).toHaveAttribute('autocomplete', 'one-time-code')
  await expect(input).toHaveAttribute('inputmode', 'numeric')
  await expect(input).toHaveAttribute('maxlength', '6')
  await expect(dialog.getByRole('button', { name: /Kirim ulang kode/ })).toBeDisabled()

  const real = await outboxCode(email, 'verify-email')
  await input.fill(real === '000000' ? '111111' : '000000')
  await dialog.getByRole('button', { name: 'Verifikasi', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Kode salah atau sudah kedaluwarsa.')
  expect(problems.filter((p) => p.includes('400'))).toHaveLength(1)
  problems.splice(0)

  await input.fill(real)
  await dialog.getByRole('button', { name: 'Verifikasi', exact: true }).click()
  // The account is made and the email verified: sign-up moves on to the (skippable) student verification step.
  await expect(page).toHaveURL(/langkah=3/)
  await expect(page.getByRole('heading', { level: 1, name: 'Verifikasi status mahasiswa' })).toBeVisible()
})

test('an unverified password sign-in shows the code step with a fresh code', async ({ page, problems }) => {
  const { email } = await startSignUp(page, 'belum')
  const first = await outboxCode(email, 'verify-email')
  await page.goto('/masuk')
  const form = page.locator('main')
  await form.getByLabel('Email').fill(email)
  await form.getByLabel('Kata Sandi', { exact: true }).fill('Sandi-rahasia-123')
  await form.getByRole('button', { name: 'Masuk ke Akun' }).click()
  await expect(form.getByText(`Masukkan kode 6 digit yang kami kirim ke ${email}. Berlaku 10 menit.`)).toBeVisible()
  expect(problems.filter((p) => p.includes('403'))).toHaveLength(1)
  problems.splice(0)
  const fresh = await outboxCode(email, 'verify-email', first)
  await form.getByLabel('Kode verifikasi').fill(fresh)
  await form.getByRole('button', { name: 'Verifikasi', exact: true }).click()
  await expect(page).toHaveURL(/langkah=3/)
  await expect(page.getByRole('heading', { level: 1, name: 'Verifikasi status mahasiswa' })).toBeVisible()
})

test('/verifikasi-email without an email never claims success and links to sign-in', async ({ page }) => {
  await page.goto('/verifikasi-email')
  await expect(page.getByText('Email berhasil diverifikasi')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Ke Halaman Masuk' })).toHaveAttribute('href', '/masuk')
  await page.goto('/verifikasi-email?token=abc')
  await expect(page.getByText('Email berhasil diverifikasi')).toHaveCount(0)
})

test('/verifikasi-email?email= renders the code step and verifies', async ({ page }) => {
  const { email } = await startSignUp(page, 'halaman')
  await page.goto(`/verifikasi-email?email=${encodeURIComponent(email)}`)
  await expect(page.getByText(`Masukkan kode 6 digit yang kami kirim ke ${email}`)).toBeVisible()
  await page.getByLabel('Kode verifikasi').fill(await outboxCode(email, 'verify-email'))
  await page.getByRole('button', { name: 'Verifikasi', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
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
  // Audit 2026-11-24: no dead-end "Kata sandi diperbarui" page any more; the reset goes straight back to /masuk with a toast.
  await expect(page.getByText('Kata sandi diperbarui. Silakan masuk.')).toBeVisible()
  await expect(page).toHaveURL(/\/masuk/)
})

test('the reset page rejects a missing token', async ({ page }) => {
  await page.goto('/reset-password')
  await expect(page.getByRole('heading', { name: 'Tautan tidak valid' })).toBeVisible()
})

test('campus-email form shows for a real student and rejects a domain that is not a campus', async ({ page, problems }) => {
  await signUpVerified(page, 'kampus')
  await page.goto('/profile/verifikasi')
  await expect(page.getByLabel('Email Kampus')).toBeVisible()
  await page.getByLabel('Email Kampus').fill('budi@gmail.com')
  await page.getByRole('button', { name: 'Kirim kode' }).click()
  await expect(page.getByRole('alert')).toContainText('belum terdaftar')
  // The browser logs the 400 as a console error; it is the expected outcome here.
  expect(problems.filter((p) => p.includes('400'))).toHaveLength(1)
  problems.splice(0)
})

test('campus-email code verifies the student and the profile shows it', async ({ page }) => {
  await signUpVerified(page, 'kampus2')
  await page.goto('/profile/verifikasi')
  const campus = `mhs-${Date.now()}@binus.ac.id`
  await page.getByLabel('Email Kampus').fill(campus)
  await page.getByRole('button', { name: 'Kirim kode' }).click()
  await expect(page.getByText(`Kode dikirim ke ${campus}`)).toBeVisible()
  await page.getByLabel('Kode 6 digit').fill(await outboxCode(campus, 'campus-email'))
  await page.getByRole('button', { name: 'Verifikasi', exact: true }).click()
  await expect(page.getByText('Terverifikasi lewat').first()).toBeVisible()
})

test('an invalid campus link shows an error on the profile form', async ({ page }) => {
  await signUpVerified(page, 'kampus3')
  await page.goto('/profile/verifikasi?campus=invalid')
  await expect(page.getByRole('alert')).toContainText('tidak berhasil')
})

test('the demo student has no campus form (pre-verified)', async ({ page }) => {
  await loginAs(page, 'student')
  await page.goto('/profile/verifikasi')
  await expect(page.getByText('Terverifikasi lewat').first()).toBeVisible()
  await expect(page.getByLabel('Email Kampus')).toHaveCount(0)
})

test('a signed-in student can register as an owner from /owner/login and reach the dashboard', async ({ page }) => {
  await signUpVerified(page, 'pemilik')
  await page.goto('/owner/login')
  await page.getByRole('button', { name: 'Daftarkan diri sebagai pemilik' }).click()
  // Registering is the "Data pemilik" step of the stepped sign-up, entered at step 3 with the account already made.
  await expect(page).toHaveURL(/\/masuk\?peran=pemilik&langkah=3/)
  const form = page.locator('main')
  await form.getByLabel('Nomor WhatsApp').fill('abc')
  await form.getByRole('button', { name: 'Lanjut' }).click()
  await expect(form.getByText('Isi nomor WhatsApp dengan angka')).toBeVisible()
  await form.getByLabel('Nomor WhatsApp').fill('0812 3456 7890')
  await form.getByRole('button', { name: 'Lanjut' }).click()
  await expect(page).toHaveURL(/langkah=4/)
  await form.getByRole('button', { name: 'Nanti saja' }).click()
  await form.getByRole('button', { name: 'Ke dashboard' }).click()
  // A new owner can look around, but kos can only be registered once the documents are approved.
  await expect(page).toHaveURL(/\/owner\/dashboard$/)
  await expect(page.getByTestId('owner-status-banner')).toContainText('Lengkapi dokumen untuk mulai mendaftarkan kos')
  await expect(page.getByRole('heading', { name: 'Papan okupansi', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Belum ada kos' })).toBeVisible()
})

test('mobile /masuk keeps Kembali and the brand, stacks the demo buttons, and never fetches the hidden photo', async ({ page }) => {
  const photoRequests: string[] = []
  page.on('request', (r) => {
    if (/room-(survey|living)[^/]*\.(webp|jpe?g|png|avif)(\?|$)/.test(r.url())) photoRequests.push(r.url())
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/masuk')
  await expect(page.getByRole('link', { name: 'Kembali' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'KoBo, ke beranda' })).toBeVisible()
  const student = await page.getByRole('button', { name: 'Masuk sebagai Mahasiswa' }).boundingBox()
  const owner = await page.getByRole('button', { name: 'Masuk sebagai Pemilik' }).boundingBox()
  expect(student && owner).toBeTruthy()
  // Stacked or side by side, the two boxes must not intersect, and both stay inside the 390px viewport.
  const apart = student!.y + student!.height <= owner!.y + 1 || owner!.y + owner!.height <= student!.y + 1 || student!.x + student!.width <= owner!.x + 1 || owner!.x + owner!.width <= student!.x + 1
  expect(apart, 'demo buttons overlap').toBe(true)
  for (const b of [student!, owner!]) expect(b.x >= 0 && b.x + b.width <= 390, 'demo button outside the viewport').toBe(true)
  await page.waitForLoadState('networkidle')
  expect(photoRequests, 'hidden aside photos must stay unfetched').toEqual([])
})

test('"Kembali" from a signed-out owner-route redirect goes home instead of looping back to /masuk', async ({ page }) => {
  await page.goto('/owner/dashboard')
  await expect(page).toHaveURL(/\/masuk\?peran=pemilik&next=%2Fowner%2Fdashboard/)
  await expect(page.getByRole('link', { name: 'Kembali' })).toHaveAttribute('href', '/')
  await page.getByRole('link', { name: 'Kembali' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('owner sign-in honours ?next', async ({ page }) => {
  await ownIp(page)
  await page.goto('/masuk?peran=pemilik&next=%2Fowner%2Fkos')
  await page.getByRole('button', { name: 'Masuk sebagai Pemilik' }).click()
  await expect(page).toHaveURL(/\/owner\/kos$/)
})

test('the Demo Student sent to an owner route is not left at a dead end', async ({ page }) => {
  await ownIp(page)
  await page.goto('/masuk?next=%2Fowner%2Fdashboard')
  await page.getByRole('button', { name: 'Masuk sebagai Mahasiswa' }).click()
  await expect(page).toHaveURL(/\/owner\/login$/)
  await expect(page.getByRole('button', { name: 'Daftarkan diri sebagai pemilik' })).toBeDisabled()
  await page.getByRole('button', { name: 'Keluar dan masuk sebagai pemilik' }).click()
  await expect(page).toHaveURL(/\/masuk\?peran=pemilik/)
  await page.getByRole('button', { name: 'Masuk sebagai Pemilik' }).click()
  await expect(page).toHaveURL(/\/owner\/dashboard$/)
})
