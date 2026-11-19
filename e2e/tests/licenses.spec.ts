import { test, expect } from '../gap/fixtures'

// F-03: map and place data are credited (map corner, footer link, /lisensi). X-04: a skip link to the main content.

test('[F-03] /lisensi lists every data source with its licence link', async ({ page }) => {
  await page.goto('/lisensi')
  await expect(page.getByRole('heading', { level: 1, name: 'Lisensi & Sumber Data' })).toBeVisible()
  for (const name of ['OpenStreetMap', 'Overture Maps Places', 'Foursquare Open Source Places (via Overture)']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: 'Lihat lisensi' }).first()).toHaveAttribute('href', /^https:\/\//)
})

test('[F-03] the footer links to /lisensi and the search map credits OpenStreetMap', async ({ page }) => {
  await page.goto('/search')
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap')
  await expect(page.locator('.leaflet-control-attribution').getByRole('link', { name: 'Data tempat' })).toHaveAttribute('href', '/lisensi')
  await page.getByRole('contentinfo').getByRole('link', { name: 'Data peta & tempat' }).click()
  await expect(page).toHaveURL(/\/lisensi$/)
})

test('[X-04] the first Tab stop is a skip link that moves focus to the main content', async ({ page }) => {
  await page.goto('/syarat')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible() // the lazy page (and its <main id="main">) is mounted
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Lewati ke konten utama' })
  await expect(skip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main')).toBeFocused()
})
