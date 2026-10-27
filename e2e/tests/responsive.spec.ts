import type { Page } from '@playwright/test'
import { test, expect, loginAs } from './fixtures'

// Responsive regression gate: every top-level route stays free of horizontal page scroll at phone, tablet, short
// laptop and desktop widths, and the overlays that matter on a phone fit the viewport. Layout only, no pixel snapshots.

const VIEWPORTS = [
  { name: '390 phone', width: 390, height: 844 },
  { name: '768 tablet', width: 768, height: 1024 },
  { name: '1280x650 laptop', width: 1280, height: 650 },
  { name: '1600x900 desktop', width: 1600, height: 900 },
] as const

const STUDENT_ROUTES = ['/', '/search', '/kos/kos-1', '/my-kos', '/profile', '/does-not-exist', '/verifikasi-email', '/reset-password', '/owner/owner-1', '/kontak', '/syarat', '/privasi']
const OWNER_ROUTES = ['/owner/dashboard', '/owner/dashboard?tab=tindakan', '/owner/kos', '/owner/reviews']

/** The page may not scroll sideways. A negative value is the reserved scrollbar gutter. */
const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

async function settle(page: Page, url: string) {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
}

const trpc = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { data } }) })
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
const payment = (over: Record<string, unknown> = {}) => ({ id: 'pay-1', provider: 'XENDIT', status: 'PENDING', checkoutUrl: 'https://checkout-staging.xendit.co/x', expiresAt: iso(20 * 60_000), paidAt: null, receiptNumber: null, receiptNo: null, ...over })
const invoice = (id: string, over: Record<string, unknown> = {}) => ({ id, status: 'UNPAID', dueDate: '2026-11-01', amount: 1_650_000, receiptNo: null, receiptNumber: null, activePayment: null, latestPayment: null, canPay: true, ...over })
const tenancy = (id: string, status: string, derivedStatus: string, invoices: unknown[]) => ({
  id,
  status,
  derivedStatus,
  startDate: '2026-11-01',
  durationMonths: 3,
  expiresAt: iso(6 * 3600_000),
  kos: { id: 'kos-1', name: 'Kost Wisma Sakura Syahdan Panjang Sekali', address: 'Jl. Syahdan No. 12, Kemanggisan, Jakarta Barat', image: null, ownerName: 'Ibu Ratna Hendrawan', ownerPhone: '081234567890' },
  room: { id: `room-${id}`, roomNumber: '101', floor: 1, type: 'Deluxe AC', priceMonthly: 1_650_000 },
  invoices,
  canReview: false,
  review: null,
})

for (const vp of VIEWPORTS) {
  test.describe(`responsive @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('student routes do not scroll sideways', async ({ page }) => {
      await loginAs(page, 'student')
      for (const url of STUDENT_ROUTES) {
        await settle(page, url)
        expect(await horizontalOverflow(page), `${url} at ${vp.name}`).toBeLessThanOrEqual(0)
      }
    })

    test('kos detail sections wrap, stay in page flow, and remain reachable', async ({ page }) => {
      await page.goto('/kos/kos-1')
      const poi = page.locator('.kos-poi')
      const categories = poi.locator('.kos-poi__categories button')
      await expect(categories).toHaveCount(7)
      const poiBox = (await poi.boundingBox())!
      const poiColumns = await poi.locator('.kos-poi__categories').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
      // Narrow: 2 columns. Wide: a 12-track grid where the first four categories take 3 tracks and the rest 4 (4 + 3 tiles).
      expect(poiColumns).toBe(vp.width <= 390 ? 2 : 12)
      const firstRowTiles = await categories.evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().top === els[0].getBoundingClientRect().top).length)
      expect(firstRowTiles).toBe(vp.width <= 390 ? 2 : 4)
      for (const button of await categories.all()) {
        const box = (await button.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(poiBox.x)
        expect(box.x + box.width).toBeLessThanOrEqual(poiBox.x + poiBox.width + 1)
        if (vp.width <= 390) expect(box.height).toBeGreaterThanOrEqual(40)
      }
      await page.screenshot({ path: test.info().outputPath('poi.png') })

      const amenities = page.locator('.kos-amenities')
      await expect(amenities.locator('.kos-amenities__scope')).not.toHaveCount(0)
      await page.screenshot({ path: test.info().outputPath('amenities.png') })

      const ruleButtons = page.locator('.kos-rules__toggle')
      await expect(ruleButtons).not.toHaveCount(0)
      for (let i = 0; i < await ruleButtons.count(); i++) {
        const button = ruleButtons.nth(i)
        // Rule groups start collapsed; each opens on demand.
        await expect(button).toHaveAttribute('aria-expanded', 'false')
        const panel = page.locator(`#${await button.getAttribute('aria-controls')}`)
        await button.click()
        await expect(panel).toBeVisible()
        expect(await panel.evaluate((el) => getComputedStyle(el).overflowY)).toBe('visible')
        await panel.scrollIntoViewIfNeeded()
        const clause = panel.locator('.kos-rules__clause')
        if (await clause.count()) {
          await clause.scrollIntoViewIfNeeded()
          const bounds = (await clause.boundingBox())!
          expect(bounds.x).toBeGreaterThanOrEqual(0)
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(vp.width)
        }
      }
      if (vp.width === 1280) expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(vp.height)
      await page.screenshot({ path: test.info().outputPath('rules.png') })

      const reviews = page.locator('.kos-reviews')
      const aspectColumns = await reviews.locator('.kos-reviews__aspects').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
      const reviewWidth = (await reviews.boundingBox())!.width
      expect(aspectColumns).toBe(reviewWidth >= 600 ? 2 : 1)
      await reviews.scrollIntoViewIfNeeded()
      await page.screenshot({ path: test.info().outputPath('reviews.png') })
    })

    test('owner routes do not scroll sideways', async ({ page }) => {
      await loginAs(page, 'owner')
      for (const url of OWNER_ROUTES) {
        await settle(page, url)
        expect(await horizontalOverflow(page), `${url} at ${vp.name}`).toBeLessThanOrEqual(0)
      }
    })

    test('signed-out pages and the sign-in page fit', async ({ page }) => {
      await settle(page, '/owner/login')
      expect(await horizontalOverflow(page), `/owner/login at ${vp.name}`).toBeLessThanOrEqual(0)
      await settle(page, '/')
      await page.getByRole('button', { name: 'Masuk', exact: true }).click()
      await expect(page).toHaveURL(/[/]masuk/)
      const form = page.locator('main .auth-main')
      await expect(form).toBeVisible()
      const box = (await form.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    })

    test('my kos invoice rows wrap in every payment state', async ({ page }) => {
      await loginAs(page, 'student')
      const rentals = [
        tenancy('t-1', 'PENDING', 'booking', [invoice('i-1')]),
        tenancy('t-2', 'PENDING', 'booking', [invoice('i-2', { activePayment: payment(), canPay: false })]),
        tenancy('t-3', 'ACTIVE', 'paid', [
          invoice('i-3', { status: 'PAID', receiptNo: 'KB-0001', receiptNumber: 1, latestPayment: payment({ status: 'REFUND_PENDING' }) }),
          invoice('i-4', { dueDate: '2026-12-01', latestPayment: payment({ id: 'p4', status: 'REFUND_FAILED' }), canPay: false }),
        ]),
      ]
      await page.route('**/api/trpc/booking.mine*', (r) => r.fulfill(trpc(rentals)))
      await settle(page, '/my-kos')
      await expect(page.getByTestId('tenancy-card')).toHaveCount(rentals.length)
      expect(await horizontalOverflow(page), `/my-kos stubbed at ${vp.name}`).toBeLessThanOrEqual(0)
      // Every action button stays inside its card.
      const cards = page.getByTestId('tenancy-card')
      for (let i = 0; i < rentals.length; i++) {
        const card = (await cards.nth(i).boundingBox())!
        for (const button of await cards.nth(i).getByRole('button').all()) {
          const b = await button.boundingBox()
          if (!b) continue
          expect(b.x, `button inside card ${i}`).toBeGreaterThanOrEqual(card.x - 1)
          expect(b.x + b.width, `button inside card ${i}`).toBeLessThanOrEqual(card.x + card.width + 1)
        }
      }
    })

    test('owner mark-paid modal fits the viewport and its buttons are reachable', async ({ page }) => {
      await loginAs(page, 'owner')
      await settle(page, '/owner/dashboard')
      await page.getByRole('button', { name: /Tandai Lunas/ }).first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const box = (await dialog.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
      // The footer may sit below the fold of a short viewport, but must be reachable by scrolling the body.
      const cancel = dialog.getByRole('button', { name: 'Batal' })
      await cancel.scrollIntoViewIfNeeded()
      await expect(cancel).toBeInViewport()
    })
  })
}

test.describe('phone-only layout', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('mobile dock tap targets are at least 40px and clear the page end', async ({ page }) => {
    await loginAs(page, 'student')
    await settle(page, '/profile')
    const links = page.locator('.mobile-only-dock a')
    expect(await links.count()).toBeGreaterThanOrEqual(3)
    for (const link of await links.all()) {
      const b = (await link.boundingBox())!
      expect(b.height).toBeGreaterThanOrEqual(40)
      expect(b.width).toBeGreaterThanOrEqual(40)
    }
    // Scrolled to the very end, the footer's last line is not hidden behind the dock.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const dock = (await page.locator('.mobile-only-dock').boundingBox())!
    const footer = (await page.locator('footer').boundingBox())!
    expect(footer.y + footer.height).toBeLessThanOrEqual(dock.y + 1)
  })

  test('owner room board becomes stacked cards on a phone', async ({ page }) => {
    await loginAs(page, 'owner')
    await settle(page, '/owner/dashboard')
    const row = page.getByRole('row').filter({ hasText: 'Kamar 101' })
    await expect(row).toBeVisible()
    const rowBox = (await row.boundingBox())!
    expect(rowBox.width).toBeLessThanOrEqual(390)
    // The row action menu opens inside the viewport instead of being clipped by a scroll wrapper.
    await row.getByRole('button', { name: /Aksi lainnya/ }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const m = (await menu.boundingBox())!
    expect(m.x).toBeGreaterThanOrEqual(0)
    expect(m.x + m.width).toBeLessThanOrEqual(390)
  })

  test('search filter popover stays inside the viewport', async ({ page }) => {
    await loginAs(page, 'student')
    await settle(page, '/search')
    await page.getByRole('button', { name: /^Filter/ }).click()
    const panel = page.locator('.kobo-popover').first()
    await expect(panel).toBeVisible()
    const b = (await panel.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(390)
  })

  test('owner room list becomes label/value cards on a phone', async ({ page }) => {
    await loginAs(page, 'owner')
    await settle(page, '/owner/kos')
    const row = page.getByRole('row').filter({ hasText: 'Lt. 1' }).first()
    await expect(row).toBeVisible()
    const b = (await row.boundingBox())!
    expect(b.x + b.width).toBeLessThanOrEqual(390)
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    // The room action button keeps its full tap size inside the card.
    const action = row.getByRole('button', { name: /Aksi Kamar/ })
    const a = (await action.boundingBox())!
    expect(a.width).toBeGreaterThanOrEqual(40)
    expect(a.height).toBeGreaterThanOrEqual(40)
  })

  test('toasts sit above the dock, full width', async ({ page }) => {
    await loginAs(page, 'student')
    await settle(page, '/profile')
    await page.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'kobo-toasts'
      el.innerHTML = '<div id="probe" style="pointer-events:auto;height:40px">probe</div>'
      document.body.appendChild(el)
    })
    const probe = (await page.locator('#probe').boundingBox())!
    const dock = (await page.locator('.mobile-only-dock').boundingBox())!
    expect(probe.y + probe.height).toBeLessThanOrEqual(dock.y)
    expect(probe.width).toBeGreaterThanOrEqual(390 - 40)
  })
})
