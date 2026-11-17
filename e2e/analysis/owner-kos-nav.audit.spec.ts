import { test, expect, loginAs } from './safe-fixtures'

test('Kelola properti: sticky section nav jumps to Tata tertib dan denda and follows the scroll', async ({ page }) => {
  await loginAs(page, 'owner')
  await page.goto('/owner/kos')
  const nav = page.getByRole('navigation', { name: 'Bagian halaman' })
  await expect(nav.getByRole('link')).toHaveText(['Properti', 'Kamar', 'Tata tertib dan denda'])
  await expect(nav.getByRole('link', { name: 'Properti' })).toHaveAttribute('aria-current', 'true')

  await nav.getByRole('link', { name: 'Tata tertib dan denda' }).click()
  await expect(page).toHaveURL(/#tata-tertib$/)
  await expect(nav.getByRole('link', { name: 'Tata tertib dan denda' })).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('heading', { name: /Tata tertib dan denda/ })).toBeInViewport()

  // Sticky: still on screen after scrolling, and the spy follows manual scrolling back up.
  expect((await nav.boundingBox())!.y).toBeLessThan(120)
  await page.waitForTimeout(1100)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(nav.getByRole('link', { name: 'Properti' })).toHaveAttribute('aria-current', 'true')
})
