import { test, expect } from './fixtures'
import { hold, newOwnerWorld, newStudent, sql } from './seams'

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

test('a listing title is a real link that supports keyboard and new-tab navigation', async ({ page }) => {
  await page.goto('/search')
  const card = page.locator('.search-cards-grid .card-hover-lift').first()
  const title = card.getByRole('link')
  await expect(title).toBeVisible()
  const name = await title.innerText()
  const link = page.getByRole('link', { name, exact: true }).first()
  await link.focus()
  await expect(link).toBeFocused()
  const popupPromise = page.context().waitForEvent('page')
  await link.click({ modifiers: ['ControlOrMeta'] })
  const popup = await popupPromise
  await expect(popup).toHaveURL(/\/kos\//)
  await popup.close()
  await expect(page).toHaveURL(/\/search/)
  await link.focus()
  await link.press('Enter')
  await expect(page).toHaveURL(/\/kos\//)
})

test('carousel and survey controls work above the listing link with 44px touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const card = page.locator('.kobo-featured-grid .card-hover-lift').first()
  const image = card.locator('img').first()
  await expect(image).toBeVisible()
  const initialSrc = await image.getAttribute('src')
  const next = card.getByRole('button', { name: 'Foto berikutnya' })
  await next.click()
  await expect(image).not.toHaveAttribute('src', initialSrc!)
  await expect(page).toHaveURL(/\/$/)
  const hitArea = await next.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const after = getComputedStyle(el, '::after')
    return { width: rect.width - parseFloat(after.left) - parseFloat(after.right), height: rect.height - parseFloat(after.top) - parseFloat(after.bottom) }
  })
  expect(hitArea.width).toBeGreaterThanOrEqual(44)
  expect(hitArea.height).toBeGreaterThanOrEqual(44)
  const survey = card.getByRole('button', { name: 'Survey', exact: true })
  expect((await survey.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await survey.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('a kos with every room held shows Penuh and keeps its Survey action', async ({ browser }) => {
  const owner = await newOwnerWorld(browser, { label: 'revamp-full', rooms: 1 })
  const student = await newStudent(browser, { label: 'revamp-full-stu' })
  try {
    await hold(owner, student, owner.rooms[0].id)
    const district = `RevampPenuh${Date.now()}`
    await sql('UPDATE "Kos" SET district = $1 WHERE id = $2', [district, owner.kosId])
    await student.page.goto(`/search?q=${district}`)
    const card = student.page.locator('.card-hover-lift').filter({ has: student.page.getByRole('heading', { name: owner.kosName, exact: true }) })
    await expect(card.getByText('Penuh', { exact: true })).toBeVisible()
    await expect(card.getByText('Sisa 0 kamar', { exact: true })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Survey', exact: true })).toBeVisible()
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('each page sets its own tab title and Home returns on back', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('KoBo')
  await page.locator('a[href="/search"]').first().click()
  await expect(page).toHaveURL(/\/search/)
  await expect(page).toHaveTitle('KoBo | Cari kos')
  const cardLink = page.locator('.search-cards-grid .card-hover-lift').first().getByRole('link')
  const kosName = (await cardLink.innerText()).trim()
  await cardLink.click()
  await expect(page).toHaveURL(/\/kos\//)
  // Search's own title also starts with "KoBo |", so require the kos name to prove Detail set it.
  await expect(page).toHaveTitle(new RegExp(`^KoBo \\| ${kosName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, .+$`))
  await page.goBack()
  await page.goBack()
  await expect(page).toHaveTitle('KoBo')
  await page.goto('/tidak-ada-halaman-ini')
  await expect(page).toHaveTitle('KoBo | Halaman tidak ditemukan')
})

test('popular-campus chips fit the hero at 1280x650 and wrap to at most two rows at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 650 })
  await page.goto('/')
  const chips = page.getByRole('navigation', { name: 'Kampus populer' }).getByRole('link')
  await expect(chips).toHaveCount(5)
  const last = (await chips.last().boundingBox())!
  expect(last.y + last.height).toBeLessThanOrEqual(650)
  await page.screenshot({ path: test.info().outputPath('chips-1280x650.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  const tops = await chips.evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size)
  expect(tops).toBeLessThanOrEqual(2)
  for (const box of await chips.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44)
})

test('a popular-campus chip on Home opens the campus search', async ({ page }) => {
  await page.goto('/')
  const search = page.waitForResponse((res) => res.url().includes('/api/trpc/kos.search') && res.ok())
  await page.getByRole('navigation', { name: 'Kampus populer' }).getByRole('link', { name: 'UI Depok', exact: true }).click()
  await expect(page).toHaveURL(/\/search\?campus=ui-depok/)
  await search
})

test('an owner writes house rules and the public page shows them in place of the empty message', async ({ browser }) => {
  const owner = await newOwnerWorld(browser, { label: 'revamp-rules', rooms: 1 })
  try {
    await owner.page.goto(`/kos/${owner.kosId}`)
    await expect(owner.page.getByText('Pemilik belum mengisi tata tertib dan denda.', { exact: true })).toBeVisible()

    await owner.page.goto('/owner/kos')
    await owner.page.getByRole('button', { name: 'Aksi lainnya' }).first().click()
    await owner.page.getByRole('menuitem', { name: 'Tata tertib' }).click()
    const dialog = owner.page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Tambah kelompok aturan' }).click()
    await dialog.getByRole('button', { name: 'Simpan tata tertib' }).click()
    await expect(dialog.getByText('Isi judul dan minimal satu aturan di setiap kelompok.')).toBeVisible()
    await dialog.getByLabel('Judul kelompok').fill('Jam tamu')
    await dialog.getByLabel('Aturan (satu per baris)').fill('Tamu pulang pukul 21.00\nTamu lawan jenis tidak masuk kamar')
    await dialog.getByRole('button', { name: 'Simpan tata tertib' }).click()
    await expect(owner.page.getByText('Tata tertib disimpan.')).toBeVisible()

    await owner.page.goto(`/kos/${owner.kosId}`)
    await expect(owner.page.getByText('Jam tamu').first()).toBeVisible()
    await expect(owner.page.getByText('Pemilik belum mengisi tata tertib dan denda.', { exact: true })).toHaveCount(0)
  } finally {
    await owner.ctx.close()
  }
})

test('footer links open the draft Contact, Terms and Privacy pages', async ({ page }) => {
  for (const [link, heading, path] of [
    ['Hubungi kami', 'Hubungi kami', '/kontak'],
    ['Syarat dan ketentuan', 'Syarat dan ketentuan', '/syarat'],
    ['Kebijakan privasi', 'Kebijakan privasi', '/privasi'],
  ] as const) {
    await page.goto('/search')
    await page.getByRole('navigation', { name: 'Informasi KoBo' }).getByRole('link', { name: link, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
})

test('on a phone, a booking bar appears above the dock once the booking box is out of view', async ({ browser }) => {
  const owner = await newOwnerWorld(browser, { label: 'revamp-bar', rooms: 1 })
  const student = await newStudent(browser, { label: 'revamp-bar-stu' })
  try {
    const page = student.page
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/kos/${owner.kosId}`)
    const bar = page.getByRole('region', { name: 'Ringkasan pemesanan' })
    await expect(bar).toBeVisible()
    const dock = (await page.locator('.mobile-only-dock').boundingBox())!
    const box = (await bar.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(dock.y + 1)
    await page.screenshot({ path: test.info().outputPath('phone-bar-390.png') })
    await page.locator('aside.booking-sidebar').scrollIntoViewIfNeeded()
    await expect(bar).toHaveCount(0)
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(bar).toBeVisible()
    await bar.getByRole('button', { name: 'Ajukan', exact: true }).click()
    await expect(page).toHaveURL(/\/checkout\//)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('a long kos name is truncated with an ellipsis, not clipped', async ({ browser }) => {
  const owner = await newOwnerWorld(browser, { label: 'revamp-long-' + 'x'.repeat(70), rooms: 1 })
  try {
    const district = `RevampLong${Date.now()}`
    await sql('UPDATE "Kos" SET district = $1 WHERE id = $2', [district, owner.kosId])
    await owner.page.goto(`/search?q=${district}`)
    const h3 = owner.page.getByRole('heading', { name: owner.kosName, exact: true })
    await expect(h3).toBeVisible()
    const result = await h3.evaluate((el) => {
      // The inline link keeps its full text width and the h3 clips it, so the link's own box cannot prove
      // containment; instead check that the stretched link still wins a hit test just below the title.
      const rect = el.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + 8, rect.bottom + 6)
      return {
        overflow: getComputedStyle(el).textOverflow,
        truncated: el.scrollWidth > el.clientWidth,
        stretchedLinkHit: hit?.closest('a') === el.querySelector('a'),
      }
    })
    expect(result).toEqual({ overflow: 'ellipsis', truncated: true, stretchedLinkHit: true })
  } finally {
    await owner.ctx.close()
  }
})

test('a new kos explains missing rules and locations without empty POI filters', async ({ browser }) => {
  const owner = await newOwnerWorld(browser, { label: 'revamp-empty', rooms: 1 })
  try {
    await owner.page.goto(`/kos/${owner.kosId}`)
    await expect(owner.page.getByText('Pemilik belum mengisi tata tertib dan denda.', { exact: true })).toBeVisible()
    // Either the old empty message (no snapshot) or the catalogue list: never a filter chip without places behind it.
    await expect(owner.page.getByRole('heading', { name: 'Lokasi dan sekitar kos' })).toBeVisible()
    const chips = await owner.page.locator('.nearby-chips button').count()
    if (chips === 0) await expect(owner.page.getByText('Belum ada data lokasi untuk kos ini.', { exact: true })).toBeVisible()
    else {
      // Opens on Sorotan when there is anything to highlight; either way the open view lists a place or offers "Tampilkan ... lagi" for places beyond the primary radius.
      expect(chips).toBeLessThanOrEqual(16)
      await expect(owner.page.locator('.nearby-route, .kos-poi button[aria-expanded]').first()).toBeVisible()
    }
    await expect(owner.page.locator('.kos-rules__groups')).toHaveCount(0)
    await expect(owner.page.locator('.kos-rules .section-sub, .kos-poi .section-sub')).toHaveCount(0)
  } finally {
    await owner.ctx.close()
  }
})

test.describe('landing motion', () => {
  test('reduced motion never arms a reveal and every stage is visible at once', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.whyr__stage').first()).toBeVisible()
    expect(await page.locator('[data-reveal="armed"]').count()).toBe(0)
    await expect(page.locator('.whyr__title')).toHaveCSS('opacity', '1')
  })

  test.describe('with motion allowed', () => {
    test.use({ reducedMotion: 'no-preference' })

    test('hero is usable immediately and each why row reveals once it scrolls into view', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('navigation', { name: 'Kampus populer' }).getByRole('link')).toHaveCount(5)
      const row = page.locator('.whyr__row').nth(3)
      await row.scrollIntoViewIfNeeded()
      await expect(row).toHaveAttribute('data-reveal', 'in')
      await expect(row.locator('.whyr__stage')).toHaveCSS('opacity', '1', { timeout: 3000 })
      await expect(row.locator('.whyr__pin').last()).toHaveCSS('opacity', '1', { timeout: 3000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  })
})
