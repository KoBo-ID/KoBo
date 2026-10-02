import { test, expect, loginAs } from './fixtures'
import { signUpVerified } from './accounts'

// Money flow 2 (spec section 11): owner marks a room paid -> status paid -> kuitansi page.
// The unpaid invoice is arranged by a booking from a second, freshly registered account, so the test does not
// depend on how many due/overdue rooms the seed happens to contain.

type Room = { id: string; roomNumber: string; status: string }
type OwnerKos = { id: string; name: string; rooms: Room[] }

async function trpcGet<T>(res: { json(): Promise<unknown> }): Promise<T> {
  const body = (await res.json()) as { result: { data: { json?: T } & T } }
  return (body.result.data.json ?? body.result.data) as T
}

test('owner marks a booked room paid and opens its kuitansi', async ({ page, browser }) => {
  await loginAs(page, 'owner')
  const kosList = await trpcGet<OwnerKos[]>(await page.request.get('/api/trpc/owner.myKos'))
  const kos = kosList.find((k) => k.rooms.some((r) => r.status === 'vacant'))
  expect(kos, 'an owner kos with a vacant room').toBeTruthy()
  const vacant = kos!.rooms.filter((r) => r.status === 'vacant')

  // A second account books a vacant room: invoice 1 is now unpaid and the room reads "Booking".
  // Parallel tests may grab the same room, so a CONFLICT just means "try another one".
  const baseURL = test.info().project.use.baseURL as string
  const tenantCtx = await browser.newContext({ baseURL })
  const tenant = await tenantCtx.newPage()
  await signUpVerified(tenant, 'penyewa')
  const startDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  let room: Room | undefined
  for (const candidate of [...vacant].sort(() => Math.random() - 0.5)) {
    const res = await tenantCtx.request.post('/api/trpc/booking.create', {
      data: { roomId: candidate.id, startDate, durationMonths: 3 },
      headers: { origin: new URL(baseURL).origin },
    })
    if (res.ok()) {
      room = candidate
      break
    }
    expect(res.status(), 'only a lost race may fail').toBe(409)
  }
  expect(room, 'tenant booked a vacant room').toBeTruthy()
  await tenantCtx.close()

  await page.goto(`/owner/dashboard?kos=${kos!.id}`)
  const row = page.getByRole('row').filter({ hasText: `Kamar ${room!.roomNumber}` })
  await expect(row.getByText('Booking', { exact: true })).toBeVisible()

  await row.getByRole('button', { name: `Tandai Lunas Kamar ${room!.roomNumber}` }).click()
  await expect(row.getByText('Lunas', { exact: true })).toBeVisible()

  const link = row.getByRole('link', { name: `Lihat kuitansi Kamar ${room!.roomNumber}` })
  await expect(link).toHaveAttribute('href', /\/kuitansi\/\d+$/)
  await link.click()
  await expect(page).toHaveURL(/\/kuitansi\/\d+$/)
  await expect(page.getByTestId('kuitansi-no')).toHaveText(/^KB\/\d{4}\/\d{2}\/\d{4}$/)
  await expect(page.getByRole('button', { name: 'Unduh PDF' })).toBeVisible()
})

test('a kos created in the owner workspace appears in Kelola Properti', async ({ page }) => {
  await loginAs(page, 'owner')
  await page.goto('/owner/kos')
  const name = `Kost Uji E2E ${Date.now()}`
  await page.getByRole('button', { name: 'Tambah Kos Baru' }).click()
  await page.getByLabel('Nama Properti Kos').fill(name)
  await page.getByLabel('Alamat Lengkap Kos').fill('Jl. Uji Coba No. 1')
  await page.getByRole('button', { name: 'Simpan Kos Baru' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
})

test('a signed-out visitor is not shown a kuitansi', async ({ page }) => {
  await page.goto('/kuitansi/1')
  await expect(page.getByRole('heading', { name: 'Masuk untuk Melihat Kuitansi' })).toBeVisible()
})
