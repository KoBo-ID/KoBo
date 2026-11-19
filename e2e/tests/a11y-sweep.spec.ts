import { test, expect, loginAs } from '../gap/fixtures'

// Accessibility and feel sweep (G-02, G-04, G-06, G-07, X-06): one interactive element per control, no heading skips on Detail,
// labelled lightbox and visit notes, a single "Kos Saya" on phones.

test.skip(!!process.env.BASE_URL, 'uses the shared demo accounts and the seeded kos of the local e2e server')

test('[G-02] the Detail page never nests a button inside a link', async ({ page }) => {
  await loginAs(page, 'student')
  await page.goto('/kos/kos-1')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('a button, button a')).toHaveCount(0)
})

test('[G-04] the Detail page headings never skip a level', async ({ page }) => {
  await page.goto('/kos/kos-1')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const levels = await page.locator('main h1, main h2, main h3, main h4, main h5, main h6').evaluateAll((els) =>
    els.map((el) => Number(el.tagName.slice(1))),
  )
  expect(levels.length).toBeGreaterThan(1)
  levels.forEach((level, i) => {
    const previous = i === 0 ? 0 : levels[i - 1]
    expect(level, `heading #${i + 1} (h${level}) follows h${previous}`).toBeLessThanOrEqual(previous + 1)
  })
})

test('[G-04] the phone dock is a labelled navigation landmark', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Navigasi seluler' })).toBeVisible()
})

test('[G-06] the photo gallery controls have accessible names', async ({ page }) => {
  await page.goto('/kos/kos-1')
  await page.getByRole('button', { name: /^Lihat Semua \(\d+ Foto\)$/ }).click()
  const gallery = page.getByRole('dialog')
  await expect(gallery.getByRole('button', { name: 'Tutup galeri foto' })).toBeVisible()
  await expect(gallery.getByRole('button', { name: 'Foto sebelumnya' })).toBeVisible()
  await expect(gallery.getByRole('button', { name: 'Foto berikutnya' })).toBeVisible()
})

test('[G-06][X-06] the visit notes field has a label and an ellipsis placeholder', async ({ page }) => {
  await loginAs(page, 'student')
  await page.goto('/kos/kos-1')
  await page.getByRole('button', { name: 'Jadwalkan Survey Gratis' }).first().click()
  const notes = page.getByRole('dialog').getByLabel(/Catatan Khusus/)
  await expect(notes).toBeVisible()
  await expect(notes).toHaveAttribute('placeholder', /…$/)
})

test('[G-07] at 390px the header does not repeat "Kos Saya" next to the dock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAs(page, 'student')
  await page.goto('/search')
  await expect(page.getByRole('navigation', { name: 'Navigasi seluler' })).toBeVisible()
  // The dock carries the label; the header keeps only its icon (the footer link further down is a separate list).
  await expect(page.locator('header').getByText('Kos Saya', { exact: true }).filter({ visible: true })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Navigasi seluler' }).getByText('Kos Saya', { exact: true })).toBeVisible()
})
