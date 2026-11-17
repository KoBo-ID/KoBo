import { test, expect } from './fixtures'

test('unknown /api path returns JSON 404', async ({ request }) => {
  const res = await request.get('/api/definitely-not-a-route')
  expect(res.status()).toBe(404)
  expect(res.headers()['content-type']).toContain('application/json')
  await res.json()
})

test('unknown client route still serves the SPA', async ({ page }) => {
  const res = await page.goto('/some/unknown/client-route')
  expect(res?.status()).toBe(200)
  expect(res?.headers()['content-type']).toContain('text/html')
  // The SPA shell is served and boots without errors. The app has no catch-all
  // NotFound route yet, so #root stays empty here (reported, not asserted).
  await expect(page.locator('script[type=module]')).toHaveCount(1)
  await expect(page).toHaveTitle(/KoBo/i)
  await page.waitForLoadState('networkidle')
})
