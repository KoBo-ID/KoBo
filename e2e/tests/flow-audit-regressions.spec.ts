import { test, expect, loginAs } from './fixtures'
import { ownIp } from './accounts'
import { expectHttpErrors, heldRoom, latestPayment, stubXenditCheckout, watch } from './seams'

// Permanent Playwright regression tests for flow-audit findings:
// FL-01 (?place= XSS), FL-04 (sign-up phone error), FL-07 (/owner/dashboard overflow),
// FL-12 (cancel return instant resume), FL-13 (campus sort persistence & menu role),
// and FL-19 (/masuk skip-link target #main).

test('FL-01: ?place= is HTML-escaped inside the map location pin and executes no XSS', async ({ page }) => {
  await page.goto('/search?lat=-6.2015&lng=106.7825&place=%3Cimg%20src%3Dx%20onerror%3D%22window.__xssFired%3D1%22%3E')
  await expect(page.locator('.kobo-location-pin')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __xssFired?: unknown }).__xssFired)).toBeUndefined()
  expect(await page.locator('.kobo-location-pin img').count()).toBe(0)
})

test('FL-04: sign-up with invalid WhatsApp number shows phone validation error, not name length error', async ({ page, problems }) => {
  await ownIp(page)
  await page.goto('/masuk')
  const form = page.locator('main')
  await form.getByRole('button', { name: 'Daftar baru' }).click()
  await form.getByLabel('Nama Lengkap').fill('Budi Santoso')
  await form.getByLabel('Email').fill(`fl04-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`)
  await form.getByLabel('Nomor WhatsApp Aktif').fill('123')
  await form.getByLabel('Kata Sandi', { exact: true }).fill('Password123!')
  await form.getByLabel(/Saya menyetujui/).check()
  await form.getByRole('button', { name: 'Daftar Sekarang' }).click()

  const alert = form.getByRole('alert')
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('Nomor WhatsApp tidak valid')
  await expect(alert).not.toContainText('Nama terlalu panjang')
  expectHttpErrors(problems, 400)
})

test('FL-07: /owner/dashboard has 0px horizontal overflow at 320px, 390px, and 1600px', async ({ page }) => {
  await loginAs(page, 'owner')
  for (const vp of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 1600, height: 900 },
  ]) {
    await page.setViewportSize(vp)
    await page.goto('/owner/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[aria-label="Ringkasan bulan ini"]')).toBeVisible()
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(fits, `/owner/dashboard horizontal overflow at ${vp.width}x${vp.height}`).toBe(true)
  }
})

test('FL-12: returning with ?payment=...&result=cancel allows immediate resume without 60s lockout', async ({ browser, problems }) => {
  test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')
  const held = await heldRoom(browser, { label: 'fl12-cancel' })
  await stubXenditCheckout(held.student.ctx)
  watch(held.student.page, problems)
  watch(held.owner.page, problems)
  try {
    const { page } = held.student
    await page.goto('/my-kos')
    await page.getByRole('row').filter({ hasText: 'Bulan 1' }).getByRole('button', { name: 'Bayar Sekarang' }).click()
    await page.waitForURL(/^https:\/\/checkout-staging\.xendit\.co\//)
    const attempt = await latestPayment(held.invoiceId)
    expect(attempt).toMatchObject({ provider: 'XENDIT', status: 'PENDING' })

    await page.goto(`/my-kos?payment=${attempt.id}&result=cancel`)
    await expect(page.getByRole('button', { name: 'Lanjutkan Pembayaran' })).toBeVisible()
    await expect(page.getByText(/Menunggu konfirmasi pembayaran/)).not.toBeVisible()
    await expect(page).not.toHaveURL(/result=cancel/)
    expectHttpErrors(problems)
  } finally {
    await Promise.all([held.owner.ctx.close(), held.student.ctx.close()])
  }
})

test('FL-13: campus search sort "Rating Tertinggi" persists without snapping back and uses role="menu"', async ({ page }) => {
  await page.goto('/search?campus=binus-syahdan')
  await expect(page).toHaveURL(/sort=distance_asc/)
  const sortTrigger = page.getByRole('button', { name: /Terdekat/ })
  await expect(sortTrigger).toBeVisible()
  await sortTrigger.click()

  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitemradio', { name: 'Rating Tertinggi' }).click()

  await page.waitForTimeout(300)
  await expect(page.getByRole('button', { name: 'Rating Tertinggi' })).toBeVisible()
  await expect(page).not.toHaveURL(/sort=distance_asc/)
})

test('FL-19: /masuk has main#main with tabindex="-1" targeted by the skip link', async ({ page }) => {
  await page.goto('/masuk')
  const main = page.locator('main#main')
  await expect(main).toHaveCount(1)
  await expect(main).toHaveAttribute('tabindex', '-1')

  const skipLink = page.locator('a.skip-link[href="#main"]')
  await skipLink.focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('main')
})
