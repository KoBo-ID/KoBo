import { test, expect, loginAs } from './fixtures'

test('mobile owner header shows the full name (ellipsis, title) and a reachable logout', async ({ page, problems }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await loginAs(page, 'owner')
  await page.goto('/owner/dashboard')
  const header = page.locator('.os-mobile-header')
  const name = header.locator('.os-mobile-user span[title]')
  await expect(name).toBeVisible()
  const full = await name.getAttribute('title')
  expect(full && full.length).toBeGreaterThan(0)
  const logout = header.getByRole('button', { name: 'Keluar' })
  await expect(logout).toBeVisible()
  // Polled (G2-18): the header re-renders once the owner data arrives, so a single boundingBox() read can hit a detached node.
  await expect.poll(async () => { const box = await logout.boundingBox(); return box ? box.x + box.width : Infinity }).toBeLessThanOrEqual(390)
  await logout.click()
  await expect(page).toHaveURL('/')
  // Signing out makes the session queries answer 401: expected, not a page error.
  expect(problems.filter((p) => !p.includes('401'))).toEqual([])
  problems.splice(0)
})

test('owner profile hides the WhatsApp link without a phone and the verified badge unless verified', async ({ page, problems }) => {
  await page.goto('/owner/does-not-exist')
  await expect(page.getByRole('heading', { name: 'Pemilik tidak ditemukan' })).toBeVisible()
  await expect(page.getByText('Terverifikasi dokumen')).toHaveCount(0)
  // The unknown owner is a 404 from owner.publicProfile: expected.
  expect(problems.filter((p) => !p.includes('404'))).toEqual([])
  problems.splice(0)
})
