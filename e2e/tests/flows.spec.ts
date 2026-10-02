import { test, expect } from './fixtures'
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
  const input = page.getByRole('textbox', { name: 'Cari lokasi atau kos' })
  await expect(input).toHaveValue(/Kemanggisan/i)
  await page.reload()
  await expect(page).toHaveURL(/loc=loc-kemanggisan/)
  await expect(input).toHaveValue(/Kemanggisan/i)
})

test('detail renders from kos.detail', async ({ page }) => {
  const detail = page.waitForResponse((r) => r.url().includes('/api/trpc/kos.detail') && r.status() === 200)
  await page.goto('/kos/kos-1')
  const d = await trpcData<{ name: string; address: string; rooms: unknown[]; owner: { name: string } }>(await detail)
  await expect(page.getByRole('heading', { level: 1, name: d.name })).toBeVisible()
  await expect(page.getByText(d.address).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: d.owner.name }).first()).toBeVisible()
  // Rooms come from the API: the picker reports the number of room types it received.
  await expect(page.getByText(/tipe kamar tersedia/)).toBeVisible()
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
  await page.getByRole('button', { name: 'Ajukan Sewa & Bayar' }).click()
  await expect(page).toHaveURL(/\/checkout\/kos-1/)
  await expect(page.getByRole('heading').first()).toBeVisible()
})
