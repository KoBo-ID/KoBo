import { test, expect } from './fixtures'

// WCAG 2.4.3: after a client-side navigation to a new page, focus moves into the new page instead of staying on the link.

const activeIsMain = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.activeElement?.id === 'main' || document.activeElement?.tagName === 'H1')

test('focus moves to the new page after a footer link and after search to detail', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Hubungi kami' }).click()
  await expect(page).toHaveURL(/[/]kontak$/)
  await expect.poll(() => activeIsMain(page)).toBe(true)

  await page.goto('/search')
  await page.locator('a[href^="/kos/"]').first().click()
  await expect(page).toHaveURL(/[/]kos[/]/)
  await expect.poll(() => activeIsMain(page)).toBe(true)
})

test('a search-only change keeps focus where it is, and the skip link still works', async ({ page }) => {
  await page.goto('/search')
  const input = page.getByRole('searchbox').or(page.locator('input[type="search"], input[type="text"]')).first()
  await input.focus()
  await page.keyboard.type('a')
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT')

  await page.goto('/kontak')
  await page.locator('.skip-link').focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('main')
})
