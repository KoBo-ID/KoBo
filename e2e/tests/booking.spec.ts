import { test, expect, loginAs } from './fixtures'

// Application flow: renter applies -> owner approves -> renter pays -> ACTIVE.

test('demo student applies, gets owner approval, pays and sees an active rental', async ({ page, browser }) => {
  await loginAs(page, 'student')

  // kos.detail tells us which kos still has a vacant room (seed numbers may change).
  const search = await page.request.get('/api/trpc/kos.list')
  const cards = (await search.json()).result.data as { id: string; name: string; availableRooms: number }[]
  const kos = cards.find((k) => k.availableRooms > 0)
  expect(kos, 'a kos with a vacant room').toBeTruthy()

  await page.goto(`/kos/${kos!.id}`)
  await page.getByRole('button', { name: 'Ajukan Sewa' }).click()
  await expect(page).toHaveURL(new RegExp(`/checkout/${kos!.id}\\?room=`))

  await page.getByLabel('Pekerjaan atau kegiatan utama').fill('Mahasiswa BINUS')
  await page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
  await expect(page.getByRole('heading', { name: 'Pengajuan Terkirim' })).toBeVisible()
  await page.getByRole('link', { name: 'Pantau Pengajuan' }).click()
  await page.getByRole('tab', { name: /Pengajuan Sewa/ }).click()
  await expect(page.getByTestId('application-card').filter({ hasText: kos!.name })).toContainText('Menunggu Pemilik')

  const ownerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const ownerPage = await ownerContext.newPage()
  await loginAs(ownerPage, 'owner')
  await ownerPage.goto(`/owner/dashboard?kos=${kos!.id}&tab=tindakan`)
  await ownerPage.getByTestId('owner-application').filter({ hasText: 'Mahasiswa BINUS' }).getByRole('button', { name: 'Terima' }).click()
  await ownerPage.getByRole('dialog').getByRole('button', { name: 'Terima Pengajuan' }).click()
  await expect(ownerPage.getByTestId('owner-application').filter({ hasText: 'Mahasiswa BINUS' })).toHaveCount(0)
  await ownerContext.close()

  await page.reload()
  await page.getByRole('tab', { name: /Pengajuan Sewa/ }).click()
  await expect(page.getByTestId('application-card').filter({ hasText: kos!.name })).toContainText('Diterima')
  await page.getByRole('tab', { name: /Kamar yang Disewa/ }).click()
  // Approval only creates the obligation; the attempt is opened on demand, then the labelled demo simulator completes it.
  await page.getByRole('button', { name: 'Bayar Sekarang' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page).toHaveURL(/\/my-kos/)
  const card = page.getByTestId('tenancy-card').filter({ hasText: kos!.name }).first()
  await expect(card).toHaveAttribute('data-status', 'ACTIVE')
  await expect(card.getByText('Sewa Aktif')).toBeVisible()
})

test('checkout asks a signed-out visitor to sign in instead of booking', async ({ page }) => {
  await page.goto('/kos/kos-1')
  await page.getByRole('button', { name: 'Ajukan Sewa' }).click()
  await expect(page).toHaveURL(/\/checkout\/kos-1/)
  await expect(page.getByRole('button', { name: 'Masuk untuk Mengajukan' })).toBeVisible()
})
