import { test, expect, loginAs } from './fixtures'
import { signUpVerified } from './accounts'

// Daftar Tunggu (docs/superpowers/specs/2026-10-02-waitlist-design.md). The seed has no completely full demo kos, so the
// test builds one: the demo owner adds a two-room kos and a second, freshly registered account books both rooms. Then the
// demo student queues, the owner cancels one booking in the dashboard and the student is offered the room. The demo reset
// is NOT pressed (it would wipe parallel tests); the student leaves the queue at the end.

async function trpcData<T>(res: { json(): Promise<unknown> }): Promise<T> {
  const body = (await res.json()) as { result: { data: { json?: T } & T } }
  return (body.result.data.json ?? body.result.data) as T
}

test('demo student queues for a full kos, gets the room when the owner frees it, and reaches checkout', async ({ page, browser }) => {
  const baseURL = test.info().project.use.baseURL as string
  const origin = { origin: new URL(baseURL).origin }

  // 1. The demo owner adds a kos with two rooms.
  await loginAs(page, 'owner')
  const name = `Kos Antre E2E ${Date.now()}`
  const created = await page.request.post('/api/trpc/owner.kos.create', {
    data: {
      name,
      gender: 'CAMPUR',
      address: 'Jl. Antrean No. 1',
      district: 'Kebayoran Baru',
      city: 'Jakarta Selatan',
      lat: -6.2,
      lng: 106.8,
      electricityType: 'INCLUDED',
      privateAmenities: [],
      sharedAmenities: [],
      studentDiscountAmount: 0,
      initialRooms: { count: 2, priceMonthly: 1_500_000 },
    },
    headers: origin,
  })
  expect(created.ok(), 'owner.kos.create').toBe(true)
  const { id: kosId } = await trpcData<{ id: string }>(created)
  const kos = (await trpcData<{ id: string; rooms: { id: string; roomNumber: string }[] }[]>(await page.request.get('/api/trpc/owner.myKos'))).find((k) => k.id === kosId)!

  // 2. A second account books both rooms (a parallel test that grabbed one first just means it is already taken).
  const tenantCtx = await browser.newContext({ baseURL })
  const tenant = await tenantCtx.newPage()
  await signUpVerified(tenant, 'penyewa-antre')
  const startDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  for (const room of kos.rooms) {
    const res = await tenantCtx.request.post('/api/trpc/booking.create', { data: { roomId: room.id, startDate, durationMonths: 3 }, headers: origin })
    if (!res.ok()) expect(res.status(), 'only a lost race may fail').toBe(409)
  }
  await tenantCtx.close()

  // 3. The demo student sees "Kamar Penuh" and joins.
  await loginAs(page, 'student')
  await page.goto(`/kos/${kosId}`)
  await expect(page.getByTestId('waitlist-join')).toContainText('Kamar Penuh')
  await page.getByRole('button', { name: 'Ikut Daftar Tunggu' }).click()
  await expect(page.getByTestId('waitlist-queued')).toContainText('Kamu antrean #1')

  // 4. The owner cancels one booking from the dashboard.
  await loginAs(page, 'owner')
  await page.goto(`/owner/dashboard?kos=${kosId}`)
  const row = page.getByRole('row').filter({ hasText: 'Booking' }).first()
  const roomNumber = (await row.getByRole('button', { name: /Aksi lainnya Kamar/ }).getAttribute('aria-label'))!.replace('Aksi lainnya Kamar ', '')
  page.once('dialog', (d) => void d.accept())
  await row.getByRole('button', { name: /Aksi lainnya Kamar/ }).click()
  await page.getByRole('menuitem', { name: 'Batalkan Booking' }).click()
  await expect(page.getByText('Sewa diakhiri. Kamar kembali kosong.')).toBeVisible()

  // 5. The student reloads: the room is theirs for 24 hours, and "Pesan Sekarang" leads to checkout.
  await loginAs(page, 'student')
  await page.goto(`/kos/${kosId}`)
  const offer = page.getByTestId('waitlist-offer')
  await expect(offer).toContainText(`Kamar ${roomNumber} ditawarkan untukmu`)
  await expect(offer).toContainText('sisa')
  await offer.getByRole('button', { name: 'Pesan Sekarang' }).click()
  await expect(page).toHaveURL(new RegExp(`/checkout/${kosId}\\?room=`))

  // 6. Clean up: decline, so the demo student keeps no live entry for the other specs.
  await page.goto(`/kos/${kosId}`)
  await page.getByTestId('waitlist-offer').getByRole('button', { name: 'Lewati' }).click()
  await expect(page.getByText('Penawaran dilewati.')).toBeVisible()
})
