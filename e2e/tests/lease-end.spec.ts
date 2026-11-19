import { test, expect, loginAs } from './fixtures'

// G2-03: nothing ends a tenancy at its lease end (the owner does), so both sides must show it. G2-06: a deliberate
// BAD_REQUEST message from the server reaches the visit dialog instead of the generic validation line.
// The server shapes (booking.mine, owner.board) are stubbed: the dates are what is under test, not the seed.

const trpc = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { data } }) })
const wibToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
const shift = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })

const tenancy = (leaseEndDate: string) => ({
  id: 't-lease',
  status: 'ACTIVE',
  derivedStatus: 'paid',
  startDate: '2026-01-01',
  durationMonths: 3,
  leaseEndDate,
  expiresAt: null,
  endedAt: null,
  endCause: null,
  kos: { id: 'kos-1', name: 'Kos Uji Sewa', address: 'Jl. Uji', image: null, ownerName: 'Pemilik', ownerPhone: null },
  room: { id: 'room-lease', roomNumber: '101', floor: 1, type: 'Deluxe AC', priceMonthly: 1_650_000 },
  invoices: [{ id: 'i-1', status: 'PAID', dueDate: '2026-01-01', amount: 1_650_000, receiptNo: 'KB-0001', receiptNumber: 1, activePayment: null, latestPayment: null, canPay: false }],
  canReview: false,
  review: null,
})

test.describe('lease end: student card', () => {
  test('an active tenancy shows its lease end day', async ({ page }) => {
    await loginAs(page, 'student')
    await page.route('**/api/trpc/booking.mine*', (r) => r.fulfill(trpc([tenancy(shift(30))])))
    await page.goto('/my-kos')
    const note = page.getByTestId('lease-end')
    await expect(note).toContainText('Sewa berakhir')
    await expect(note).not.toContainText('sudah berakhir')
  })

  test('after the lease end the card tells the student to contact the owner', async ({ page }) => {
    await loginAs(page, 'student')
    await page.route('**/api/trpc/booking.mine*', (r) => r.fulfill(trpc([tenancy(wibToday())])))
    await page.goto('/my-kos')
    await expect(page.getByTestId('lease-end')).toContainText('Masa sewa sudah berakhir. Hubungi pemilik untuk memperpanjang atau mengakhiri sewa.')
  })
})

test('lease end: the owner gets an action item with the existing end-tenancy action', async ({ page }) => {
  await loginAs(page, 'owner')
  await page.route('**/api/trpc/owner.board*', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    const data = body.result.data
    for (const r of data.rooms) { r.leaseEnded = false; r.leaseEndDate = null }
    const room = data.rooms.find((r: { tenancyId: string | null }) => r.tenancyId)
    room.leaseEnded = true
    room.leaseEndDate = shift(-2)
    data.summary.leaseEndedCount = 1
    await route.fulfill({ response: res, json: body })
  })
  await page.goto('/owner/dashboard?tab=tindakan')
  const section = page.getByTestId('lease-ended-section')
  await expect(section).toContainText('Masa sewa berakhir')
  await expect(page.getByRole('tab', { name: /Perlu tindakan/ })).toContainText(/\d/)
  await section.getByRole('button', { name: /Akhiri sewa Kamar/ }).click()
  // The existing confirmation, reachable from this tab.
  await expect(page.getByRole('alertdialog')).toContainText('Akhiri sewa Kamar')
})

test('[G2-06] the visit dialog shows the server\'s own BAD_REQUEST message', async ({ page, problems }) => {
  await loginAs(page, 'student')
  const message = 'Tanggal survey harus setelah hari ini.'
  await page.route('**/api/trpc/visit.create*', (r) =>
    r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message, code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400, path: 'visit.create' } } }) }))
  await page.goto('/kos/kos-1')
  await page.getByRole('button', { name: /Jadwalkan Survey Gratis/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder(/0812/).fill('0812 3456 7890')
  await dialog.getByRole('button', { name: /Konfirmasi Jadwal Survey/ }).click()
  await expect(dialog).toContainText(message)
  // The browser logs the stubbed 400 itself; that is the one expected console error.
  expect(problems.filter((m) => !/status of 400/.test(m))).toEqual([])
  problems.length = 0
})
