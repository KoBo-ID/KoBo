import { deflateSync } from 'node:zlib'
import { test, expect, loginAs } from './fixtures'

// Slice 11: reviews (tenant writes, owner replies), photo upload (client-side resize -> presigned PUT -> confirm)
// and the room edit action. No hard-coded counts: every assertion is relative to what the test just did.

type Room = { id: string; roomNumber: string; status: string; type: string }
type OwnerKos = { id: string; name: string; rooms: Room[] }

async function trpcData<T>(res: { json(): Promise<unknown> }): Promise<T> {
  const body = (await res.json()) as { result: { data: { json?: T } & T } }
  return (body.result.data.json ?? body.result.data) as T
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
/** A small valid RGB PNG (a diagonal gradient), generated so the repo carries no binary fixture. */
function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) row.set([(x * 255) / width, (y * 255) / height, 160], 1 + x * 3)
    rows.push(row)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

test('a paying tenant reviews their kos, it appears on Detail, and the owner replies in Ulasan', async ({ page, browser }) => {
  const baseURL = test.info().project.use.baseURL as string
  const origin = new URL(baseURL).origin

  // The demo owner's kos with a vacant room.
  const ownerCtx = await browser.newContext({ baseURL })
  const ownerPage = await ownerCtx.newPage()
  await loginAs(ownerPage, 'owner')
  const kosList = await trpcData<OwnerKos[]>(await ownerPage.request.get('/api/trpc/owner.myKos'))
  const kos = kosList.find((k) => k.rooms.some((r) => r.status === 'vacant'))
  expect(kos, 'an owner kos with a vacant room').toBeTruthy()

  // Demo student books one of those rooms and pays through the simulator (API), so the tenancy is ACTIVE.
  await loginAs(page, 'student')
  const startDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  let paymentId = ''
  for (const room of kos!.rooms.filter((r) => r.status === 'vacant').sort(() => Math.random() - 0.5)) {
    const res = await page.request.post('/api/trpc/booking.create', { data: { roomId: room.id, startDate, durationMonths: 3 }, headers: { origin } })
    if (res.ok()) {
      paymentId = (await trpcData<{ payment: { id: string } }>(res)).payment.id
      break
    }
    expect(res.status(), 'only a lost race may fail').toBe(409)
  }
  expect(paymentId, 'student booked a room').toBeTruthy()
  const paid = await page.request.post('/api/trpc/payment.simulate', { data: { paymentId }, headers: { origin } })
  expect(paid.ok(), 'simulated payment').toBe(true)

  // Write the review on Detail.
  const comment = `Kamar nyaman, Wi-Fi lancar (${Date.now()})`
  await page.goto(`/kos/${kos!.id}`)
  await page.getByRole('button', { name: 'Tulis Ulasan Kos' }).click()
  await page.getByRole('button', { name: 'Rating keseluruhan: 4 bintang' }).click()
  await page.getByRole('button', { name: 'Kebersihan Kamar & Gedung: 5 bintang' }).click()
  await page.getByLabel('Ceritakan pengalaman tinggal Anda').fill(comment)
  await page.getByRole('button', { name: 'Kirim Ulasan' }).click()
  await expect(page.getByText(comment)).toBeVisible()

  // Demo student is campus-verified, so the snapshot badge shows.
  await expect(page.getByText('Penyewa Terverifikasi').first()).toBeVisible()

  // The owner sees it in Ulasan and replies.
  await ownerPage.goto(`/owner/reviews?kos=${kos!.id}`)
  const card = ownerPage.getByTestId('owner-review').filter({ hasText: comment })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Beri Tanggapan Pemilik' }).click()
  const reply = `Terima kasih sudah menginap (${Date.now()})`
  await card.getByLabel('Tanggapan pemilik').fill(reply)
  await card.getByRole('button', { name: 'Kirim Tanggapan Pemilik' }).click()
  await expect(card.getByText(reply)).toBeVisible()

  // ...and the tenant sees the reply on Detail.
  await page.reload()
  await expect(page.getByText(reply)).toBeVisible()
  await ownerCtx.close()
})

test('an owner uploads a photo: it is resized in the browser, stored, and shows up in the kos photos', async ({ page }) => {
  await loginAs(page, 'owner')
  await page.goto('/owner/kos')
  await page.getByRole('button', { name: 'Foto', exact: true }).first().click()

  const photos = page.getByTestId('kos-photo')
  await expect(page.getByText('Foto Kos', { exact: true })).toBeVisible()
  await expect(page.getByText('Memuat foto…')).toHaveCount(0)
  const before = await photos.count()

  await page.getByTestId('photo-input').setInputFiles({ name: 'ruang-tamu.png', mimeType: 'image/png', buffer: makePng(1000, 600) })
  await expect(photos).toHaveCount(before + 1)

  // The stored object is a real WebP, served from the public URL.
  const last = photos.last().getByRole('img')
  const src = await last.getAttribute('src')
  expect(src).toBeTruthy()
  const served = await page.request.get(src!)
  expect(served.ok()).toBe(true)
  expect(served.headers()['content-type']).toBe('image/webp')
  expect((await served.body()).byteLength).toBeLessThan(2 * 1024 * 1024)

  // Cleanup keeps reruns tidy.
  page.once('dialog', (d) => void d.accept())
  await photos.last().getByRole('button', { name: /Hapus foto/ }).click()
  await expect(photos).toHaveCount(before)
})

test('an owner edits a room from Kelola Properti', async ({ page }) => {
  await loginAs(page, 'owner')
  await page.goto('/owner/kos')
  const first = page.getByRole('button', { name: /^Edit kamar / }).first()
  await expect(first).toBeVisible()
  const label = (await first.getAttribute('aria-label'))!
  const roomNumber = label.replace('Edit kamar ', '')
  await first.click()
  const type = `Tipe Uji ${Date.now()}`
  await page.getByLabel('Tipe Kamar').fill(type)
  await page.getByRole('button', { name: 'Simpan Perubahan' }).click()
  await expect(page.getByRole('row').filter({ hasText: roomNumber }).filter({ hasText: type }).first()).toBeVisible()
})
