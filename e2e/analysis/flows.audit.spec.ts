import { test, expect } from './safe-fixtures'
import type { Page } from '@playwright/test'

// tRPC GET envelope: {result:{data:{json?:...}}} (or an array for batches).
async function trpcData<T>(res: { json(): Promise<unknown> }): Promise<T> {
  const body = await res.json()
  const payload = Array.isArray(body) ? body[0] : body
  const data = (payload as { result: { data: { json?: T } & T } }).result.data
  return (data.json ?? data) as T
}

const isSearch = (url: string) => url.includes('/api/trpc/kos.search')

/** Resolves with the next kos.search response while running `action`. */
async function searchAfter(page: Page, action: () => Promise<unknown>) {
  const [res] = await Promise.all([page.waitForResponse((r) => isSearch(r.url()) && r.status() === 200), action()])
  return res
}

test('search filters round-trip through the URL and hit kos.search', async ({ page }) => {
  const first = page.waitForResponse((r) => isSearch(r.url()) && r.status() === 200)
  await page.goto('/search?q=Anggrek')
  const cards = await trpcData<{ name: string; district: string }[]>(await first)
  // The request carried the URL filter (q is part of the GET input).
  expect(decodeURIComponent((await first).url())).toContain('Anggrek')
  await expect(page.getByRole('button', { name: 'Hapus kata kunci' })).toBeVisible()

  // The list renders what the server returned (no hard-coded counts).
  if (cards.length > 0) {
    await expect(page.getByRole('heading', { name: cards[0].name }).first()).toBeVisible()
  } else {
    await expect(page.getByText('Tidak ada kos yang cocok')).toBeVisible()
  }

  await page.reload()
  await expect(page).toHaveURL(/q=Anggrek/)
  await expect(page.getByRole('button', { name: 'Hapus kata kunci' })).toBeVisible()
})

test('toggling filters updates the URL, refetches, and survives a reload', async ({ page }) => {
  await page.goto('/search')
  await expect(page.locator('.search-cards-grid[aria-busy="false"]')).toBeVisible()

  const res = await searchAfter(page, () => page.getByRole('button', { name: 'Khusus Putri' }).click())
  expect(decodeURIComponent(res.url())).toContain('"gender":"putri"')
  await expect(page).toHaveURL(/gender=putri/)

  await searchAfter(page, async () => {
    await page.getByRole('button', { name: /Filter/ }).click()
    await page.getByRole('button', { name: 'Diskon Mahasiswa' }).click()
  })
  await expect(page).toHaveURL(/discount=1/)
  // The badge counts exactly the applied secondary filter, not a permanent price filter (maxPrice default = PRICE_MAX).
  await expect(page.locator('.kobo-control__count')).toHaveText('1')

  await page.reload()
  await expect(page).toHaveURL(/gender=putri/)
  await expect(page).toHaveURL(/discount=1/)
  await expect(page.getByRole('button', { name: 'Khusus Putri' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.kobo-control__count')).toHaveText('1')
})

test('location filter via URL survives reload', async ({ page }) => {
  const first = page.waitForResponse((r) => isSearch(r.url()) && r.status() === 200)
  await page.goto('/search?loc=loc-kemanggisan')
  expect(decodeURIComponent((await first).url())).toMatch(/"lat":-6\.1993/)
  const input = page.getByRole('combobox', { name: 'Cari lokasi' })
  await expect(input).toHaveValue(/Kemanggisan/i)
  await page.reload()
  await expect(page).toHaveURL(/loc=loc-kemanggisan/)
  await expect(input).toHaveValue(/Kemanggisan/i)
})

test('detail renders from kos.detail', async ({ page }) => {
  const detail = page.waitForResponse((r) => r.url().includes('/api/trpc/kos.detail') && r.status() === 200)
  await page.goto('/kos/kos-1')
  const d = await trpcData<{ name: string; address: string; rooms: { type: string }[]; owner: { name: string } }>(await detail)
  await expect(page.getByRole('heading', { level: 1, name: d.name })).toBeVisible()
  await expect(page.getByText(d.address).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: d.owner.name }).first()).toBeVisible()
  // Rooms come from the API: the picker reports the number of room types it received.
  const typeCount = new Set(d.rooms.map((r) => r.type)).size
  await expect(page.getByRole('region', { name: 'Pilihan tipe kamar & ketersediaan' }).getByText(`${typeCount} tipe kamar`, { exact: true })).toBeVisible()
})

test('detail sections expose accessible filters, complete rules, and the loaded review remainder', async ({ page }) => {
  let loadedReviews = 7
  await page.route('**/api/trpc/kos.detail*', async (route) => {
    const response = await route.fetch()
    const body = await response.json() as { result: { data: { json?: Record<string, any> } & Record<string, any> } }
    const data = body.result.data.json ?? body.result.data
    data.pois = data.pois.filter((poi: { category: string }) => poi.category === 'campus').slice(0, 1)
    data.rules = [...data.rules, {
      id: 'e2e-long-rule', tier: 4, categoryTitle: 'Klausul panjang untuk pengujian', rules: ['Aturan utuh yang harus tetap tersedia setelah panel dibuka.'],
      penaltyAmount: 125000, penaltyClause: 'Klausul akhir tetap terlihat setelah halaman digulir sampai bagian paling bawah tanpa pemotongan teks.',
    }]
    data.reviews = Array.from({ length: loadedReviews }, (_, i) => ({
      id: `e2e-review-${i}`, rating: 4, comment: `Ulasan uji ${i + 1}`, createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
      authorName: `Penyewa ${i + 1}`, authorCampus: 'Kampus Uji', authorAvatar: null, verified: i === 0,
      ownerReply: i === 6 ? { text: 'Balasan pemilik untuk ulasan ketujuh.', at: new Date().toISOString() } : null,
    }))
    await route.fulfill({ response, body: JSON.stringify(body) })
  })

  await page.goto('/kos/kos-1')
  const categories = page.locator('.kos-poi__categories button')
  await expect(categories).toHaveCount(7)
  await expect(categories.first()).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Makan & Warung' }).click()
  await expect(page.getByRole('button', { name: 'Makan & Warung' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Belum ada data lokasi untuk kategori ini.')).toBeVisible()
  await expect(page.getByText(/estimasi jarak jalan kaki riil|Bebas Macet & Hemat Ongkos/)).toHaveCount(0)

  const ruleButtons = page.locator('.kos-rules__toggle')
  // Every rule group starts collapsed; "Buka semua" opens them all.
  await expect(ruleButtons.first()).toHaveAttribute('aria-expanded', 'false')
  await expect(ruleButtons.nth(1)).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Buka semua' }).click()
  await expect(ruleButtons.first()).toHaveAttribute('aria-expanded', 'true')
  await expect(ruleButtons.nth(1)).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Tutup semua' }).click()
  await expect(ruleButtons.first()).toHaveAttribute('aria-expanded', 'false')
  const ruleButton = page.getByRole('button', { name: /Klausul panjang untuk pengujian/ })
  await expect(ruleButton).toHaveAttribute('aria-expanded', 'false')
  const rulePanel = page.locator(`#${await ruleButton.getAttribute('aria-controls')}`)
  await ruleButton.focus()
  await page.keyboard.press('Space')
  await expect(ruleButton).toHaveAttribute('aria-expanded', 'true')
  await expect(rulePanel).toContainText('Aturan utuh yang harus tetap tersedia setelah panel dibuka.')
  await expect(rulePanel).toContainText('Klausul akhir tetap terlihat setelah halaman digulir sampai bagian paling bawah tanpa pemotongan teks.')
  await page.keyboard.press('Enter')
  await expect(ruleButton).toHaveAttribute('aria-expanded', 'false')
  await expect(rulePanel).toBeHidden()
  await page.keyboard.press('Space')
  await expect(ruleButton).toHaveAttribute('aria-expanded', 'true')
  await expect(rulePanel).toBeVisible()

  await expect(page.getByText(/^Ulasan uji [1-5]$/)).toHaveCount(5)
  const more = page.getByRole('button', { name: 'Lihat ulasan lainnya (2)' })
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await more.click()
  await expect(page.getByText(/^Ulasan uji [1-7]$/)).toHaveCount(7)
  await expect(page.getByText('Balasan pemilik untuk ulasan ketujuh.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lihat lebih sedikit ulasan' })).toBeFocused()
  await page.getByRole('button', { name: 'Lihat lebih sedikit ulasan' }).click()
  // The remainder stays in the DOM but hidden, so count what is visible.
  await expect(page.getByText(/^Ulasan uji [1-7]$/).filter({ visible: true })).toHaveCount(5)
  await expect(page.getByRole('button', { name: 'Lihat ulasan lainnya (2)' })).toBeFocused()
  loadedReviews = 5
  await page.reload()
  await expect(page.getByText(/^Ulasan uji [1-5]$/)).toHaveCount(5)
  await expect(page.getByRole('button', { name: /Lihat ulasan lainnya/ })).toHaveCount(0)
})

test('an unknown kos id shows the not-found state', async ({ page, problems }) => {
  await page.goto('/kos/tidak-ada-kos-ini')
  await expect(page.getByRole('heading', { name: 'Kos tidak ditemukan' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Cari Kos Lain' })).toBeVisible()
  // The browser logs the API's 404 as a console error; that is the only problem allowed here.
  expect(problems.length).toBeGreaterThan(0)
  expect(problems.every((p) => p.includes('404'))).toBe(true)
  problems.length = 0
})

test('an unknown owner id shows the not-found state', async ({ page, problems }) => {
  await page.goto('/owner/tidak-ada-pemilik')
  await expect(page.getByRole('heading', { name: 'Pemilik tidak ditemukan' })).toBeVisible()
  expect(problems.every((p) => p.includes('404'))).toBe(true)
  problems.length = 0
})

test('owner profile lists that owner kos from owner.publicProfile', async ({ page }) => {
  const res = page.waitForResponse((r) => r.url().includes('/api/trpc/owner.publicProfile') && r.status() === 200)
  await page.goto('/owner/owner-1')
  const d = await trpcData<{ owner: { name: string }; kos: { name: string }[] }>(await res)
  await expect(page.getByRole('heading', { level: 1, name: d.owner.name })).toBeVisible()
  for (const k of d.kos) await expect(page.getByText(k.name).first()).toBeVisible()
})

test('detail to checkout navigation', async ({ page }) => {
  await page.goto('/kos/kos-1')
  await page.getByRole('button', { name: 'Ajukan Sewa' }).click()
  await expect(page).toHaveURL(/\/checkout\/kos-1/)
  await expect(page.getByRole('heading').first()).toBeVisible()
})

test('unknown search text stays unchanged and continues through place search', async ({ page }) => {
  await page.goto('/search')
  const input = page.getByRole('combobox', { name: 'Cari lokasi' })
  await expect(input).toHaveAttribute('autocomplete', 'off')
  // Focusing an empty box lists nothing, and typing never offers locations or kos to jump to.
  await input.focus()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(page.getByText('Jadikan titik acuan peta')).toHaveCount(0)
  await input.fill('ban')
  await expect(page.getByText('Jadikan titik acuan peta')).toHaveCount(0)
  await input.fill('banten')
  await expect(input).toHaveValue('banten')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cari', exact: true }).click()
  await expect(page).toHaveURL(/q=banten/)
  await expect(input).toHaveValue('banten')
})

test('the home search box submits unknown text as typed', async ({ page }) => {
  await page.goto('/')
  const input = page.getByRole('combobox', { name: 'Cari area atau lokasi' })
  await input.fill('banten')
  await expect(page.getByText('Jadikan titik acuan peta')).toHaveCount(0)
  await input.press('Enter')
  await expect(page).toHaveURL(/\/search\?q=banten/)
})

test('a place the map knows becomes the reference point, and the text stays as typed', async ({ page }) => {
  const place = { label: 'Banten', lat: -6.4, lng: 106.0, radiusMeters: 80_000 }
  await page.route('**/api/trpc/place.search*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { data: place } }) }))
  await page.goto('/search')
  const input = page.getByRole('combobox', { name: 'Cari lokasi' })
  const searched = page.waitForResponse((r) => isSearch(r.url()) && /"radius":80000/.test(decodeURIComponent(r.url())) && r.status() === 200)
  await input.fill('banten')
  await page.getByRole('button', { name: 'Cari', exact: true }).click()
  await searched
  await expect(page).toHaveURL(/lat=-6\.4/)
  await expect(page).toHaveURL(/place=Banten/)
  await expect(page).toHaveURL(/r=80000/)
  await expect(page).not.toHaveURL(/q=/)
  await expect(input).toHaveValue('banten')
  await expect(page.getByRole('heading', { name: /Kos di Sekitar Banten/i })).toBeVisible()
  // The place survives a reload; the box then shows the resolved place.
  await page.reload()
  await expect(input).toHaveValue('Banten')
})

test('an unknown place or a geocoder outage falls back to a text search and says so', async ({ page, problems }) => {
  await page.route('**/api/trpc/place.search*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { data: null } }) }))
  await page.goto('/search?q=zzzz')
  await expect(page.getByText('tidak ditemukan di peta')).toBeVisible()
  await page.unroute('**/api/trpc/place.search*')
  await page.route('**/api/trpc/place.search*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Pencarian lokasi sedang tidak tersedia. Coba lagi sebentar.', code: -32603, data: { code: 'SERVICE_UNAVAILABLE', httpStatus: 503 } } }) }))
  await page.goto('/search?q=yyyy')
  await expect(page.getByText('Pencarian lokasi sedang tidak tersedia')).toBeVisible()
  // The browser logs the 503 as a console error; that is the only problem allowed here.
  expect(problems.every((p) => p.includes('503'))).toBe(true)
  problems.length = 0
})
