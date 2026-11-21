import type { Page } from '@playwright/test'
import path from 'node:path'
import { test, expect } from './fixtures'
import { outboxCode, ownIp } from './accounts'
import { sql } from './seams'

// The stepped owner sign-up at /masuk?peran=pemilik: Akun -> Kode email -> Data pemilik -> Dokumen (bisa nanti).

test.skip(!!process.env.BASE_URL, 'needs the e2e database')

const JPEG = path.join(__dirname, '..', 'fixtures', 'dokumen.jpg')
const PDF = path.join(__dirname, '..', 'fixtures', 'dokumen.pdf')
const PASSWORD = 'Sandi-rahasia-123'

/** Steps 1 to 3 for a new owner. Ends on step 4 (documents). */
async function registerToStep4(page: Page, prefix: string) {
  await ownIp(page)
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await page.goto('/masuk?peran=pemilik')
  const form = page.locator('main')
  await expect(page.getByRole('button', { name: 'Pemilik kos' })).toHaveAttribute('aria-pressed', 'true')
  await form.getByRole('button', { name: 'Daftar baru' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Daftar Akun Pemilik Kos' })).toBeVisible()
  await form.getByLabel('Nama Lengkap').fill('Calon Pemilik')
  await form.getByLabel('Email').fill(email)
  await form.getByLabel('Kata Sandi', { exact: true }).fill(PASSWORD)
  await form.getByLabel(/Saya menyetujui/).check()
  await form.getByRole('button', { name: 'Daftar Sekarang' }).click()
  await expect(page).toHaveURL(/langkah=2/)
  await form.getByLabel('Kode verifikasi').fill(await outboxCode(email, 'verify-email'))
  await form.getByRole('button', { name: 'Verifikasi', exact: true }).click()

  await expect(page).toHaveURL(/langkah=3/)
  await expect(page.getByRole('heading', { level: 1, name: 'Data pemilik kos' })).toBeVisible()
  await form.getByLabel('Nomor WhatsApp').fill('abc')
  await form.getByRole('button', { name: 'Lanjut' }).click()
  await expect(form.getByText('Isi nomor WhatsApp dengan angka')).toBeVisible()
  await form.getByLabel('Nomor WhatsApp').fill('0812 3456 7890')
  await form.getByLabel('Saya pemilik properti').check()
  await form.getByRole('button', { name: 'Lanjut' }).click()

  await expect(page).toHaveURL(/langkah=4/)
  await expect(page.getByRole('heading', { level: 1, name: 'Dokumen kepemilikan' })).toBeVisible()
  return email
}

async function sendDocuments(page: Page) {
  const send = page.getByRole('button', { name: 'Kirim dokumen' })
  await expect(send).toBeDisabled()
  await page.locator('#odoc-file-ktp').setInputFiles(JPEG)
  await expect(page.getByText('dokumen.jpg terunggah')).toBeVisible()
  await page.locator('#odoc-file-land').setInputFiles(PDF)
  await expect(page.getByText('dokumen.pdf terunggah')).toBeVisible()
  await expect(send).toBeDisabled()
  await page.getByLabel(/Saya setuju dokumen ini disimpan/).check()
  await expect(send).toBeEnabled()
  await send.click()
}

test('owner sign-up: four steps, documents, closure, then a gated dashboard', async ({ page }) => {
  const email = await registerToStep4(page, 'pemilik-lengkap')

  await test.step('the stepper has four steps and step 4 is current', async () => {
    const items = page.locator('.stepper__item')
    await expect(items).toHaveCount(4)
    await expect(items.nth(3)).toHaveAttribute('aria-current', 'step')
    await expect(items.nth(2)).toHaveAttribute('data-state', 'done')
  })

  await test.step('submitting needs both files and the consent', () => sendDocuments(page))

  await test.step('the closure screen appears', async () => {
    await expect(page.getByText(/Dokumen terkirim\. .+ Kami kabari lewat email\./)).toBeVisible()
    const [row] = await sql<{ verificationStatus: string }>('SELECT "verificationStatus" FROM "OwnerProfile" WHERE "userId" = (SELECT id FROM "User" WHERE email = $1)', [email])
    expect(row.verificationStatus).toBe('MENUNGGU')
    await page.getByRole('button', { name: 'Ke dashboard' }).click()
    await expect(page.getByTestId('signup-done')).toBeVisible()
    await page.getByRole('button', { name: 'Ke dashboard' }).click()
  })

  await test.step('the dashboard says the documents are being checked and gates "Daftarkan kos"', async () => {
    await expect(page).toHaveURL(/\/owner\/dashboard$/)
    await expect(page.getByTestId('owner-status-banner')).toContainText('sedang diperiksa')
    const create = page.getByRole('button', { name: 'Daftarkan kos' })
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    await expect(create).toHaveAccessibleDescription(/Dokumen Anda sedang diperiksa\. Kos baru bisa dibuat setelah disetujui\./)
  })
})

test('owner sign-up: skipping the documents leaves a BELUM_KIRIM banner', async ({ page }) => {
  const email = await registerToStep4(page, 'pemilik-nanti')
  await page.getByRole('button', { name: 'Nanti saja' }).click()
  await expect(page.getByTestId('signup-done')).toContainText('Akun pemilik siap')
  await page.getByRole('button', { name: 'Ke dashboard' }).click()

  await expect(page).toHaveURL(/\/owner\/dashboard$/)
  await expect(page.getByTestId('owner-status-banner')).toContainText('Lengkapi dokumen untuk mulai mendaftarkan kos')
  await expect(page.getByRole('button', { name: 'Daftarkan kos' })).toHaveAttribute('aria-disabled', 'true')
  const [row] = await sql<{ verificationStatus: string }>('SELECT "verificationStatus" FROM "OwnerProfile" WHERE "userId" = (SELECT id FROM "User" WHERE email = $1)', [email])
  expect(row.verificationStatus).toBe('BELUM_KIRIM')

  await test.step('the banner button reopens the documents dialog', async () => {
    await page.getByRole('button', { name: 'Lengkapi dokumen' }).click()
    await expect(page).toHaveURL(/dokumen=1/)
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})

test('owner sign-up: a refresh at step 4 resumes at step 4', async ({ page }) => {
  await registerToStep4(page, 'pemilik-muat')
  await page.reload()
  await expect(page).toHaveURL(/langkah=4/)
  await expect(page.getByRole('heading', { level: 1, name: 'Dokumen kepemilikan' })).toBeVisible()
  await expect(page.locator('.stepper__item').nth(3)).toHaveAttribute('aria-current', 'step')
})

test('owner sign-up: submitting documents after a refresh still shows the closure screen', async ({ page }) => {
  await registerToStep4(page, 'pemilik-muat2')
  await page.reload()
  await expect(page).toHaveURL(/langkah=4/)
  await sendDocuments(page)
  await expect(page.getByText(/Dokumen terkirim\. .+ Kami kabari lewat email\./)).toBeVisible()
  await expect(page).toHaveURL(/langkah=4/)
})
