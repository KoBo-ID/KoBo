import type { Page } from '@playwright/test'
import path from 'node:path'
import { test, expect } from './fixtures'
import { outboxCode, ownIp } from './accounts'
import { trpcGet } from './seams'

// The stepped student sign-up at /masuk: Akun -> Kode email -> Verifikasi mahasiswa (skippable).
// The main e2e server runs with REQUIRE_STUDENT_VERIFICATION=0, so the VerifyBanner test patches auth.me to turn the gate on.

test.skip(!!process.env.BASE_URL, 'needs the e2e database')

const KTM = path.join(__dirname, '..', 'fixtures', 'dokumen.jpg')
const NEXT = '/kos/kos-1'
const PASSWORD = 'Sandi-rahasia-123'

/** Steps 1 and 2: fill the account form and enter the emailed code. Ends on step 3. */
async function registerToStep3(page: Page, prefix: string, start = `/masuk?next=${encodeURIComponent(NEXT)}`) {
  await ownIp(page)
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await page.goto(start)
  const form = page.locator('main')
  await form.getByRole('button', { name: 'Daftar baru' }).click()
  await expect(page).toHaveURL(/langkah=1/)
  await form.getByLabel('Nama Lengkap').fill('Calon Mahasiswa')
  await form.getByLabel('Email').fill(email)
  await form.getByLabel('Kata Sandi', { exact: true }).fill(PASSWORD)
  await form.getByLabel(/Saya menyetujui/).check()
  await form.getByRole('button', { name: 'Daftar Sekarang' }).click()
  await expect(page).toHaveURL(/langkah=2/)
  await expect(form.getByText(`Masukkan kode 6 digit yang kami kirim ke ${email}`)).toBeVisible()
  await form.getByLabel('Kode verifikasi').fill(await outboxCode(email, 'verify-email'))
  await form.getByRole('button', { name: 'Verifikasi', exact: true }).click()
  await expect(page).toHaveURL(/langkah=3/)
  await expect(page.getByRole('heading', { level: 1, name: 'Verifikasi status mahasiswa' })).toBeVisible()
  return email
}

async function pickCampus(page: Page) {
  const campus = page.getByRole('combobox', { name: 'Kampus' })
  await campus.fill('Binus')
  await page.getByRole('option', { name: /BINUS/i }).first().click()
}

test('student sign-up: account, emailed code, KTM, pending card; next survives', async ({ page }) => {
  await registerToStep3(page, 'mhs')
  await expect(page).toHaveURL(/next=%2Fkos%2Fkos-1/)

  await test.step('stepper marks step 3 as current', async () => {
    const items = page.locator('.stepper__item')
    await expect(items).toHaveCount(3)
    await expect(items.nth(2)).toHaveAttribute('aria-current', 'step')
    await expect(items.nth(0)).not.toHaveAttribute('aria-current', 'step')
    await expect(items.nth(0)).toHaveAttribute('data-state', 'done')
    await expect(items.nth(1)).toHaveAttribute('data-state', 'done')
  })

  await test.step('submit the KTM', async () => {
    await pickCampus(page)
    await page.getByLabel('NIM').fill('2501234567')
    await page.getByLabel(/Foto KTM/).setInputFiles(KTM)
    await page.getByLabel(/Saya setuju foto KTM/).check()
    await page.getByRole('button', { name: 'Kirim untuk diperiksa' }).click()
  })

  await test.step('the pending card names the review time', async () => {
    const card = page.getByTestId('ktm-pending')
    await expect(card).toBeVisible()
    const me = await trpcGet<{ studentVerification: { state: string; slaText: string } }>(page, 'auth.me')
    expect(me.studentVerification.state).toBe('PENDING')
    expect(me.studentVerification.slaText).not.toBe('')
    await expect(card).toContainText(`Dokumen sedang diperiksa · ${me.studentVerification.slaText}`)
  })

  await test.step('"Cari kos sambil menunggu" returns to the page the student came from', async () => {
    await page.getByRole('button', { name: 'Cari kos sambil menunggu' }).click()
    await expect(page).toHaveURL(new RegExp(`${NEXT}$`))
  })
})

test('stepper at 390px, Back from step 3, refresh keeps the step and the typed fields', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await ownIp(page)
  const email = `mobil-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await page.goto('/masuk')
  const form = page.locator('main')
  await form.getByRole('button', { name: 'Daftar baru' }).click()
  await form.getByLabel('Nama Lengkap').fill('Calon Mobile')
  await form.getByLabel('Email').fill(email)
  await form.getByLabel('Kata Sandi', { exact: true }).fill(PASSWORD)
  await form.getByLabel(/Saya menyetujui/).check()
  await form.getByRole('button', { name: 'Daftar Sekarang' }).click()

  await expect(page.getByText('Langkah 2 dari 3: Kode email')).toBeVisible()
  await expect(page.locator('.stepper__item').nth(1)).toHaveAttribute('aria-current', 'step')

  await form.getByLabel('Kode verifikasi').fill(await outboxCode(email, 'verify-email'))
  await form.getByRole('button', { name: 'Verifikasi', exact: true }).click()
  await expect(page).toHaveURL(/langkah=3/)
  await expect(page.getByText(/Langkah 3 dari 3/)).toBeVisible()

  await test.step('Back goes to the step 2 summary (the code is already verified)', async () => {
    await page.goBack()
    await expect(page).toHaveURL(/langkah=2/)
    await expect(page.getByRole('heading', { level: 1, name: 'Email sudah terverifikasi' })).toBeVisible()
    await expect(page.getByText('Langkah 2 dari 3')).toBeVisible()
    await page.goForward()
    await expect(page).toHaveURL(/langkah=3/)
  })

  await test.step('a refresh keeps step 3 and the text fields', async () => {
    await page.getByLabel('NIM').fill('2509876543')
    await page.getByLabel('Program studi (opsional)').fill('Teknik Informatika')
    await pickCampus(page)
    await expect(page.getByLabel('Nama lengkap sesuai KTM')).toHaveValue('Calon Mobile')
    await page.reload()
    await expect(page).toHaveURL(/langkah=3/)
    await expect(page.getByText('Langkah 3 dari 3')).toBeVisible()
    await expect(page.getByLabel('NIM')).toHaveValue('2509876543')
    await expect(page.getByLabel('Program studi (opsional)')).toHaveValue('Teknik Informatika')
    await expect(page.getByLabel('Nama lengkap sesuai KTM')).toHaveValue('Calon Mobile')
    await expect(page.getByRole('combobox', { name: 'Kampus' })).toHaveValue(/BINUS/i)
    // The photo is never kept: the form says so.
    await expect(page.getByText('Data Anda dipulihkan. Unggah ulang foto KTM.')).toBeVisible()
  })
})

test('"Nanti saja" lands on next (or /search) and the VerifyBanner reminds the student', async ({ page }) => {
  // The gate is off on this server; turn it on in what the browser sees so the banner has a reason to show.
  await page.route('**/api/trpc/**', async (route) => {
    if (!route.request().url().includes('auth.me')) return route.fallback()
    const res = await route.fetch()
    const body = await res.json()
    for (const item of Array.isArray(body) ? body : [body]) {
      const data = item?.result?.data
      const target = data?.json ?? data
      if (target && 'studentVerificationRequired' in target) target.studentVerificationRequired = true
    }
    await route.fulfill({ response: res, json: body })
  })

  await registerToStep3(page, 'nanti')
  await page.getByRole('button', { name: 'Nanti saja' }).click()
  await expect(page).toHaveURL(new RegExp(`${NEXT}$`))
  await expect(page.getByTestId('verify-banner')).toContainText('Verifikasi status mahasiswa untuk bisa menyewa')

  await test.step('without ?next it goes to /search', async () => {
    await page.context().clearCookies()
    await registerToStep3(page, 'nanti2', '/masuk')
    await page.getByRole('button', { name: 'Nanti saja' }).click()
    await expect(page).toHaveURL(/\/search$/)
    await expect(page.getByTestId('verify-banner')).toBeVisible()
  })
})
