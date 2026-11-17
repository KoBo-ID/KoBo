import { test, expect } from './fixtures'

test('home loads and lists kos from the API @postdeploy', async ({ page }) => {
  const listResponse = page.waitForResponse(
    (r) => r.url().includes('/api/trpc/kos.list') && r.request().method() === 'GET',
  )
  await page.goto('/')
  const res = await listResponse
  expect(res.status()).toBe(200)

  // tRPC batch/non-batch envelope: [{result:{data:{json:[...]}}}] or {result:{data:...}}
  const body = await res.json()
  const payload = Array.isArray(body) ? body[0] : body
  const data = payload.result.data
  const cards: { name: string }[] = data.json ?? data
  expect(cards.length).toBeGreaterThan(0)

  await expect(page.getByRole('heading', { name: cards[0].name }).first()).toBeVisible()
})

test('navbar is transparent at top and solid after the hero @postdeploy', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation').first()
  const header = page.locator('header').first()
  const target = (await header.count()) ? header : nav
  const bg = () => target.evaluate((el) => getComputedStyle(el).backgroundColor)
  const alpha = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (!m) return 1
    const p = m[1].split(/[,/ ]+/).filter(Boolean)
    return p.length > 3 ? Number(p[3]) : 1
  }

  await expect.poll(async () => alpha(await bg())).toBe(0)

  const heroHeight = await page.locator('#kobo-hero').evaluate((el) => el.getBoundingClientRect().height)
  await page.evaluate((y) => window.scrollTo(0, y + 200), heroHeight)
  await expect.poll(async () => alpha(await bg())).toBeGreaterThan(0.8)
})
