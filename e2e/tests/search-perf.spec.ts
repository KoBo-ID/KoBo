import { test, expect, type Page } from './fixtures'

// Counts how many listing cards React re-rendered. The DevTools hook receives every commit; a fiber whose props carry a
// `kos` object, that has been rendered before (alternate) and has the PerformedWork flag (1) set did real work in that commit.
const COUNT_CARD_RENDERS = `
  window.__cardRenders = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject() { return 1 },
    onCommitFiberRoot(_id, root) {
      const walk = (f) => {
        while (f) {
          if (f.alternate && (f.flags & 1) && f.memoizedProps && f.memoizedProps.kos && f.memoizedProps.kos.id) window.__cardRenders++;
          if (f.child) walk(f.child);
          f = f.sibling;
        }
      };
      walk(root.current);
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
`
const cardRenders = (page: Page) => page.evaluate(() => (window as unknown as { __cardRenders: number }).__cardRenders)

async function openSearch(page: Page) {
  await page.goto('/search')
  await expect(page.locator('.search-cards-grid > div').nth(5)).toBeVisible()
  await page.waitForTimeout(500)
}

test('hovering a card re-renders only that card, not the whole list', async ({ page }) => {
  await page.addInitScript(COUNT_CARD_RENDERS)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openSearch(page)
  const cards = page.locator('.search-cards-grid > div')
  expect(await cards.count()).toBeGreaterThanOrEqual(6)
  const before = await cardRenders(page)
  await cards.nth(0).hover()
  await cards.nth(1).hover()
  await page.waitForTimeout(200)
  const used = (await cardRenders(page)) - before
  // Hover card 0 (1 render), leave it and hover card 1 (2 renders) is the most that is needed.
  expect(used, `card renders for two hovers over ${await cards.count()} cards`).toBeLessThanOrEqual(4)
})

test('typing in the search box does not re-render the card list per keystroke', async ({ page }) => {
  await page.addInitScript(COUNT_CARD_RENDERS)
  await openSearch(page)
  const total = await page.locator('.search-cards-grid > div').count()
  const before = await cardRenders(page)
  await page.getByPlaceholder('Cari area atau lokasi…').pressSequentially('kemanggisan', { delay: 40 })
  await page.waitForTimeout(500)
  const used = (await cardRenders(page)) - before
  expect(used, `card renders while typing 11 keys over ${total} cards`).toBeLessThan(total)
  // Typing still works: the value is there and Enter searches it.
  await expect(page.getByPlaceholder('Cari area atau lokasi…')).toHaveValue('kemanggisan')
  await page.getByPlaceholder('Cari area atau lokasi…').press('Enter')
  await expect(page).toHaveURL(/loc=loc-kemanggisan|q=kemanggisan/)
})

test('card photos are sized and lazy below the first row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openSearch(page)
  const imgs = page.locator('.search-cards-grid > div img')
  expect(await imgs.count()).toBeGreaterThanOrEqual(6)
  for (let i = 0; i < 6; i++) {
    const img = imgs.nth(i)
    await expect(img, `card ${i} width attr`).toHaveAttribute('width', /\d+/)
    await expect(img, `card ${i} height attr`).toHaveAttribute('height', /\d+/)
    await expect(img, `card ${i} decoding`).toHaveAttribute('decoding', 'async')
    if (i >= 3) await expect(img, `card ${i} loading`).toHaveAttribute('loading', 'lazy')
  }
  await expect(imgs.nth(0)).not.toHaveAttribute('loading', 'lazy')
})

test('Back from a kos restores the search scroll position, also when the list is fetched again', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openSearch(page)
  await page.evaluate(() => window.scrollTo(0, 700))
  await page.waitForTimeout(300)
  const link = page.locator('.search-cards-grid a[href^="/kos/"]').nth(3)
  await link.scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const y0 = await page.evaluate(() => Math.round(window.scrollY))
  expect(y0).toBeGreaterThan(400)
  await link.click()
  await expect(page).toHaveURL(/\/kos\//)
  // A reload on the detail page empties the query cache, so the list renders only after its data loads (the real bug).
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/search/)
  await expect(page.locator('.search-cards-grid > div').nth(3)).toBeVisible()
  await page.waitForTimeout(800)
  const y1 = await page.evaluate(() => Math.round(window.scrollY))
  expect(Math.abs(y1 - y0), `scrollY after Back (${y1}) vs before leaving (${y0})`).toBeLessThanOrEqual(50)
})
