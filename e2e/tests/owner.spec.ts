import { test, expect, loginAs } from './fixtures'
import { signUpVerified } from './accounts'

// Money flow 2 (spec section 11): owner marks a room paid -> status paid -> kuitansi page.
// The unpaid invoice is arranged by a booking from a second, freshly registered account, so the test does not
// depend on how many due/overdue rooms the seed happens to contain.

type Room = { id: string; roomNumber: string; status: string }
type OwnerKos = { id: string; name: string; rooms: Room[] }

async function trpcGet<T>(res: { json(): Promise<unknown> }): Promise<T> {
  const body = (await res.json()) as { result: { data: { json?: T } & T } }
  return (body.result.data.json ?? body.result.data) as T
}

test('owner marks a booked room paid and opens its kuitansi', async ({ page, browser }) => {
  await loginAs(page, 'owner')
  const kosList = await trpcGet<OwnerKos[]>(await page.request.get('/api/trpc/owner.myKos'))
  const kos = kosList.find((k) => k.rooms.some((r) => r.status === 'vacant'))
  expect(kos, 'an owner kos with a vacant room').toBeTruthy()
  const vacant = kos!.rooms.filter((r) => r.status === 'vacant')

  // A second account applies, then the owner approves it: invoice 1 is unpaid and the room reads "Dipesan".
  // Parallel tests may grab the same room, so a CONFLICT just means "try another one".
  const baseURL = test.info().project.use.baseURL as string
  const tenantCtx = await browser.newContext({ baseURL })
  const tenant = await tenantCtx.newPage()
  await signUpVerified(tenant, 'penyewa')
  const startDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  let room: Room | undefined
  for (const candidate of [...vacant].sort(() => Math.random() - 0.5)) {
    const res = await tenantCtx.request.post('/api/trpc/application.create', {
      data: { roomId: candidate.id, startDate, durationMonths: 3, occupation: 'Mahasiswa penguji' },
      headers: { origin: new URL(baseURL).origin },
    })
    if (res.ok()) {
      room = candidate
      break
    }
    expect(res.status(), 'only a lost race may fail').toBe(409)
  }
  expect(room, 'tenant applied for a vacant room').toBeTruthy()
  await tenantCtx.close()

  await page.goto(`/owner/dashboard?kos=${kos!.id}&tab=tindakan`)
  const application = page.getByTestId('owner-application').filter({ hasText: `Kamar ${room!.roomNumber}` })
  await application.getByRole('button', { name: 'Terima' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Terima Pengajuan' }).click()
  await expect(application).toHaveCount(0)
  await page.getByRole('tab', { name: 'Ringkasan' }).click()
  const row = page.getByRole('row').filter({ hasText: `Kamar ${room!.roomNumber}` })
  await expect(row.getByText('Dipesan', { exact: true })).toBeVisible()

  await row.getByRole('button', { name: `Tandai Lunas Kamar ${room!.roomNumber}` }).click()
  const modal = page.getByRole('dialog')
  const submit = modal.getByRole('button', { name: 'Catat Lunas' })
  await expect(submit).toBeDisabled()
  // The owner re-types the exact amount shown in the label; a transfer also needs a reference.
  const label = (await modal.getByText(/Ketik jumlah yang diterima/).first().textContent()) ?? ''
  const amount = label.match(/Rp\s*([\d.]+)/)![1].replace(/\./g, '')
  await modal.getByLabel(/Ketik jumlah yang diterima/).fill(amount)
  await expect(submit).toBeEnabled()
  await modal.getByLabel('Transfer bank').check()
  await expect(submit).toBeDisabled()
  await modal.getByLabel('Nomor referensi transfer').fill('TRF-E2E-001')
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(row.getByText('Lunas', { exact: true })).toBeVisible()

  const link = row.getByRole('link', { name: `Lihat kuitansi Kamar ${room!.roomNumber}` })
  await expect(link).toHaveAttribute('href', /\/kuitansi\/\d+$/)
  await link.click()
  await expect(page).toHaveURL(/\/kuitansi\/\d+$/)
  await expect(page.getByTestId('kuitansi-no')).toHaveText(/^KB\/\d{4}\/\d{2}\/\d{4}$/)
  await expect(page.getByRole('button', { name: 'Unduh PDF' })).toBeVisible()
})

test('a kos created in the owner workspace appears in Kelola Properti', async ({ page }) => {
  await loginAs(page, 'owner')
  await page.goto('/owner/kos')
  const name = `Kost Uji E2E ${Date.now()}`
  await page.getByRole('button', { name: 'Tambah kos' }).first().click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Nama Properti Kos').fill(name)
  await form.getByLabel('Kategori Penghuni').selectOption('CAMPUR')
  await form.getByLabel('Sistem Listrik').selectOption('TOKEN')
  await form.getByLabel('Alamat Lengkap Kos').fill('Jl. Uji Coba No. 1')
  // Nothing is pre-filled: submitting an incomplete form shows a summary that links to what is missing.
  await form.getByRole('button', { name: 'Simpan Kos Baru' }).click()
  await expect(form.getByRole('alert')).toContainText('Ada isian yang perlu diperbaiki')
  await expect(form.getByLabel('Nama Properti Kos')).toHaveValue(name)
  // The geocoder is off in e2e, so the address is not found and the nearest-campus fallback appears.
  await form.getByRole('button', { name: 'Cari lokasi' }).click()
  await form.getByLabel('Pakai titik kampus terdekat').selectOption({ index: 1 })
  await expect(form.getByText('Kampus terdekat dari lokasi ini')).toBeVisible()
  await form.getByLabel('Kecamatan / Kelurahan').fill('Kemanggisan')
  await form.getByLabel('Kota / Kabupaten').fill('Jakarta Barat')
  await form.getByLabel('Jumlah Lantai').fill('2')
  await form.getByLabel('Jumlah Kamar').fill('6')
  await form.getByLabel('Harga Sewa per Kamar (Rp/bulan)').fill('1500000')
  await form.getByRole('button', { name: 'Wi-Fi' }).click()
  await form.getByRole('button', { name: 'Simpan Kos Baru' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
})

test('a signed-out visitor is not shown a kuitansi', async ({ page }) => {
  await page.goto('/kuitansi/1')
  await expect(page.getByRole('heading', { name: 'Masuk untuk Melihat Kuitansi' })).toBeVisible()
})

test('the room board keeps its column geometry across every status and floor tab', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await loginAs(page, 'owner')
  await page.goto('/owner/dashboard')
  const tabs = page.locator('[aria-label="Filter status kamar"] button, [aria-label="Filter lantai"] button')
  await expect(tabs.first()).toBeVisible()
  const geometry = () =>
    page.locator('.od-board thead th').evaluateAll((els) => els.map((e) => `${Math.round(e.getBoundingClientRect().x)}:${Math.round(e.getBoundingClientRect().width)}`).join('|'))
  const baseline = await geometry()
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click()
    expect(await geometry(), `tab ${i}`).toBe(baseline)
  }
})

test('the Hunian status counts jump to the matching room filter', async ({ page }) => {
  await loginAs(page, 'owner')
  await page.goto('/owner/dashboard')
  const stat = page.locator('.od-stat').first()
  const label = (await stat.textContent())!.replace(/\d+$/, '').trim()
  await stat.click()
  await expect(page.locator('[aria-label="Filter status kamar"] [aria-pressed="true"]')).toContainText(label)
})

test('dashboard splits into Ringkasan and Perlu tindakan, deep-linkable, with the count on the tab', async ({ page }) => {
  await loginAs(page, 'owner')
  await page.goto('/owner/dashboard')
  await expect(page.getByRole('tab', { name: 'Ringkasan' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Terkumpul bulan ini' })).toBeVisible()
  await expect(page.locator('table.kobo-table').first()).toBeVisible()

  await page.getByRole('tab', { name: /Perlu tindakan/ }).click()
  await expect(page).toHaveURL(/tab=tindakan/)
  await expect(page.getByRole('heading', { name: 'Terkumpul bulan ini' })).toHaveCount(0)
  await expect(page.locator('table.kobo-table')).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('tab', { name: /Perlu tindakan/ })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Ringkasan' }).click()
  await expect(page).not.toHaveURL(/tab=/)
})
