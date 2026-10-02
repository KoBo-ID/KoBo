import { test, expect, loginAs } from './fixtures'

// Free survey visits live on the server: the student books from the kos page, the owner sees and completes it.
// kos-1 belongs to the demo owner (see the seed). The demo reset is NOT pressed here: it would wipe the data of
// parallel tests that share the demo accounts (it is covered by the integration tests).

test('demo student schedules a survey, the demo owner sees it and marks it done', async ({ page }) => {
  await loginAs(page, 'student')
  await page.goto('/kos/kos-1')
  await expect(page.getByTestId('demo-notice')).toContainText('Akun demo')
  await page.getByRole('button', { name: 'Jadwalkan Survey Gratis' }).first().click()
  await page.getByLabel('Nomor WhatsApp').fill('081234567890')
  await page.getByRole('button', { name: 'Konfirmasi Jadwal Survey Gratis' }).click()
  await expect(page.getByText('berhasil dikonfirmasi')).toBeVisible()

  await page.goto('/my-kos')
  await page.getByRole('button', { name: /Jadwal Survey Gratis/ }).click()
  await expect(page.getByText('Terjadwal').first()).toBeVisible()

  await loginAs(page, 'owner')
  await page.goto('/owner/dashboard')
  const row = page.getByTestId('owner-visit').filter({ hasText: 'Demo Mahasiswa' }).first()
  await expect(row).toBeVisible()

  // A waiting survey is promoted above the room board, the same way "Perlu Perhatian" is.
  const surveyTop = (await page.locator('#visits-title').boundingBox())!.y
  const boardTop = (await page.locator('table.kobo-table').first().boundingBox())!.y
  expect(surveyTop).toBeLessThan(boardTop)

  await row.getByRole('button', { name: 'Tandai Selesai' }).click()
  await expect(page.getByText('Survey ditandai selesai.')).toBeVisible()
})

test('a signed-out visitor is asked to sign in before scheduling a survey', async ({ page }) => {
  await page.goto('/kos/kos-1')
  await page.getByRole('button', { name: 'Jadwalkan Survey Gratis' }).first().click()
  await expect(page.getByRole('button', { name: 'Masuk' }).last()).toBeVisible()
})

test('a real (non-demo) user does not see the demo notice', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('demo-notice')).toHaveCount(0)
})
