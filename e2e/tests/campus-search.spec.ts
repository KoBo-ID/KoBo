import { test, expect } from './fixtures'

test('campus suggestions pick a branch without rewriting free text', async ({ page }) => {
  await page.goto('/search')
  const input = page.getByRole('combobox', { name: 'Cari lokasi' })
  await input.fill('binus')
  const list = page.getByRole('listbox')
  await expect(list).toBeVisible()
  await expect(list.getByText('BINUS', { exact: true })).toBeVisible()
  await expect(list.getByRole('option').first()).toBeVisible()
  expect(await list.getByRole('option').count()).toBeLessThanOrEqual(4)
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(page).toHaveURL(/campus=binus-/)
  await expect(page).toHaveURL(/sort=distance_asc/)
  await expect(page.getByRole('heading', { name: /Kos di Sekitar BINUS/ })).toBeVisible()

  await input.fill('itb')
  await expect(page.getByRole('listbox').getByRole('option', { name: /ITB/ }).first()).toBeVisible()
  await input.press('Escape')
  await expect(input).toHaveValue('itb')
  await expect(page.getByRole('listbox')).toHaveCount(0)

  // E2E DB omits the location catalogue; provide Provinsi Banten for the region autocomplete check.
  await page.route('**/api/trpc/region.search*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ result: { data: [{ code: '36', level: 1, name: 'Banten', kind: 'provinsi', parentCode: null, lat: -6.45, lng: 106.1, path: 'Banten' }] } }),
    }),
  )
  await input.fill('banten')
  await expect(input).toHaveValue('banten')
  await expect(list).toBeVisible()
  await expect(list.getByRole('option').filter({ hasText: 'Banten' }).filter({ hasText: 'Provinsi' }).first()).toBeVisible()
})

test('home campus selection navigates with a shareable branch id', async ({ page }) => {
  await page.goto('/')
  const input = page.getByRole('combobox', { name: 'Cari area atau lokasi' })
  await input.fill('itb')
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(page).toHaveURL(/\/search\?campus=itb-ganesha/)
})

test('campus suggestions stay inside a 390px viewport with 40px options', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/search')
  const input = page.getByRole('combobox', { name: 'Cari lokasi' })
  await input.fill('binus')
  const list = page.getByRole('listbox')
  await expect(list).toBeVisible()
  const bounds = await list.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const firstOption = await list.getByRole('option').first().boundingBox()
  expect(firstOption?.height).toBeGreaterThanOrEqual(40)
})
