import { test, expect } from './fixtures'

// The catalogue is not loaded in the e2e database, so the two region procedures are answered here; kos.search is the real
// server and must receive the region code, never a point.
const BANTEN = { code: '36', level: 1, name: 'Banten', kind: 'provinsi', parentCode: null, lat: -6.45, lng: 106.1, path: 'Banten' }
const OUTLINE = {
  code: '36',
  name: 'Banten',
  kind: 'provinsi',
  center: { lat: -6.45, lng: 106.1 },
  bbox: { minLat: -7.0, maxLat: -5.8, minLng: 105.1, maxLng: 106.8 },
  polygon: { type: 'MultiPolygon', coordinates: [[[[105.1, -7.0], [106.8, -7.0], [106.8, -5.8], [105.1, -5.8], [105.1, -7.0]]]] },
}
const ok = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify({ result: { data } }) })

test('searching a province filters by its region code and outlines it, with no radius circle', async ({ page }) => {
  await page.route('**/api/trpc/region.search*', (route) => route.fulfill(ok([BANTEN])))
  await page.route('**/api/trpc/region.outline*', (route) => route.fulfill(ok(OUTLINE)))
  const searchUrls: string[] = []
  page.on('request', (r) => { if (r.url().includes('/api/trpc/kos.search')) searchUrls.push(decodeURIComponent(r.url())) })

  await page.goto('/search?q=Banten')
  await expect(page).toHaveURL(/region=36/)
  await expect(page).not.toHaveURL(/lat=|radius|[?&]r=/)
  await expect(page.getByText('kos di Banten')).toBeVisible()
  await expect(page.getByText(/dalam radius/)).toHaveCount(0)

  // Outline drawn (one interactive-less path), and no dashed radius circle.
  await expect(page.locator('.leaflet-overlay-pane path')).toHaveCount(1)
  await expect(page.locator('.leaflet-overlay-pane path[stroke-dasharray]')).toHaveCount(0)

  const last = searchUrls.at(-1) ?? ''
  expect(last).toContain('"regionCode":"36"')
  expect(last).not.toContain('"lat"')
})
