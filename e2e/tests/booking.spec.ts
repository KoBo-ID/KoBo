import { test, expect, loginAs } from './fixtures'

// Money flow 1 (spec section 11): book -> pay -> ACTIVE. The e2e database is reseeded when the server starts.
// No hard-coded counts: the room is whatever the kos page preselects as the first vacant one.

test('demo student books a vacant room, simulates payment and sees it ACTIVE in Kos Saya', async ({ page }) => {
  await loginAs(page, 'student')

  // kos.detail tells us which kos still has a vacant room (seed numbers may change).
  const search = await page.request.get('/api/trpc/kos.list')
  const cards = (await search.json()).result.data as { id: string; name: string; availableRooms: number }[]
  const kos = cards.find((k) => k.availableRooms > 0)
  expect(kos, 'a kos with a vacant room').toBeTruthy()

  await page.goto(`/kos/${kos!.id}`)
  await page.getByRole('button', { name: 'Ajukan Sewa & Bayar' }).click()
  await expect(page).toHaveURL(new RegExp(`/checkout/${kos!.id}\\?room=`))

  // The server-shaped breakdown is on screen before paying.
  const total = page.getByTestId('checkout-total')
  await expect(total).toContainText('Rp')

  await page.getByRole('button', { name: /Pesan & Bayar/ }).click()
  await expect(page.getByTestId('payment-instruction')).toBeVisible()

  await page.getByRole('button', { name: 'Simulasikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Lihat Kuitansi' })).toHaveAttribute('href', /\/kuitansi\/\d+$/)

  await page.getByRole('link', { name: 'Buka Kos Saya' }).click()
  await expect(page).toHaveURL(/\/my-kos/)
  const card = page.getByTestId('tenancy-card').filter({ hasText: kos!.name }).first()
  await expect(card).toHaveAttribute('data-status', 'ACTIVE')
  await expect(card.getByText('Sewa Aktif')).toBeVisible()
})

test('checkout asks a signed-out visitor to sign in instead of booking', async ({ page }) => {
  await page.goto('/kos/kos-1')
  await page.getByRole('button', { name: 'Ajukan Sewa & Bayar' }).click()
  await expect(page).toHaveURL(/\/checkout\/kos-1/)
  await expect(page.getByRole('button', { name: 'Masuk untuk Memesan' })).toBeVisible()
})
