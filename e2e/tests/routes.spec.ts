import { test, expect, loginAs } from './fixtures'

// Ids come from the seed snapshot of the mock data (backend/src/db/seedData.json).
const KOS_ID = 'kos-1'
const OWNER_ID = 'owner-1'

const routes = [
  '/',
  '/search',
  `/kos/${KOS_ID}`,
  `/checkout/${KOS_ID}`,
  '/my-kos',
  '/profile',
  `/owner/${OWNER_ID}`,
]

// The owner workspace needs a session with an OwnerProfile (see auth.spec.ts for the logged-out redirect).
const ownerRoutes = ['/owner/dashboard', '/owner/kos', '/owner/reviews']

for (const route of routes) {
  test(`route ${route} renders without console errors`, async ({ page }) => {
    await page.goto(route)
    // Settle: the lazy route chunk has replaced the Suspense fallback and the shell rendered.
    await expect(page.getByRole('status').filter({ hasText: 'Memuat halaman' })).toHaveCount(0)
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.getByRole('heading').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
  })
}

for (const route of ownerRoutes) {
  test(`owner route ${route} renders without console errors when signed in`, async ({ page }) => {
    await loginAs(page, 'owner')
    await page.goto(route)
    await expect(page.getByRole('status').filter({ hasText: /Memuat halaman|Memeriksa sesi/ })).toHaveCount(0)
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${route}$`))
    await page.waitForLoadState('networkidle')
  })
}
