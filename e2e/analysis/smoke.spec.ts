import { test, expect } from '@playwright/test'
import { ownIp } from '../tests/accounts'

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    return ['localhost', '127.0.0.1'].includes(u.hostname) ? route.continue() : route.abort()
  })
  await ownIp(page)
})
for (const [persona, button] of [['student', 'Masuk sebagai Mahasiswa'], ['owner', 'Masuk sebagai Pemilik']] as const) {
  test(`B5 ${persona} demo login persists`, async ({ page }) => {
    await page.goto('/masuk')
    await page.getByRole('button', { name: button }).click()
    await expect(page).not.toHaveURL(/\/masuk/)
    if (persona === 'owner') await expect(page).toHaveURL(/\/owner\/dashboard/)
    await page.reload()
    if (persona === 'owner') await expect(page).toHaveURL(/\/owner\/dashboard/)
    if (persona === 'owner') await expect(page.getByRole('heading', { name: 'Papan okupansi' })).toBeVisible()
    else await expect(page.getByRole('button', { name: 'Menu Pengguna' })).toBeVisible()
    await page.screenshot({ path: `notes/analysis/2026-10-27-workflow/artifacts/B5-${persona}.png`, mask: persona === 'owner' ? [page.locator('aside')] : [] })
  })
}
