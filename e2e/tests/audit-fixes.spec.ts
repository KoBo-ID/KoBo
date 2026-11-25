import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { outboxCode, ownIp } from './accounts'
import { heldRoom, newOwnerWorld, newStudent, apply, shiftDueDates, sql, trpcPost, watch, expectHttpErrors, type HeldRoom } from './seams'

// Audit 2026-11-24 fixes (SIM-001 arrears at lease end, SIM-006 reject reasons, SIM-011 demo listings, plus the UI findings).
// Each test says whether it drives real server state or a stub. Real state: own owner/student worlds (seams.ts), so parallel specs never collide.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const boardRow = (page: Page, roomNumber: string) => page.getByRole('row').filter({ hasText: `Kamar ${roomNumber}` })

/** A demo student pays the first invoice through the API (the UI path is covered by payment-mock.spec.ts). */
async function payFirstInvoice(held: HeldRoom) {
  const start = await trpcPost<{ paymentId: string }>(held.student.ctx, 'payment.start', { invoiceId: held.invoiceId })
  await trpcPost(held.student.ctx, 'payment.simulate', { paymentId: start.paymentId })
}

/**
 * Real state: an ACTIVE tenancy whose month 2 is past due (about 12 days) and whose month 3 is still in the future.
 * Month 1 is paid and moved well back so the months keep their numbering.
 */
async function leaseWithArrears(browser: Parameters<typeof heldRoom>[0], label: string) {
  const held = await heldRoom(browser, { label, demo: true })
  await payFirstInvoice(held)
  await sql(`UPDATE "Invoice" SET "dueDate" = "dueDate" - 120, "periodStart" = "periodStart" - 120 WHERE "tenancyId" = $1 AND status = 'PAID'`, [held.tenancyId])
  await shiftDueDates(held.tenancyId, 45)
  return held
}

/** Owner opens "Akhiri Sewa" on the board row of the room and waits for the dialog. */
async function openEndDialog(page: Page, kosId: string, roomNumber: string) {
  await page.goto(`/owner/dashboard?kos=${kosId}`)
  const row = boardRow(page, roomNumber)
  await row.getByRole('button', { name: `Aksi lainnya Kamar ${roomNumber}` }).click()
  await page.getByRole('menuitem', { name: 'Akhiri Sewa' }).click()
  const dialog = page.getByRole('alertdialog', { name: /Akhiri sewa Kamar/ })
  await expect(dialog).toBeVisible()
  return dialog
}

test('SIM-001 end lease, KEEP: the debt stays on the board as "Tunggakan penyewa lama" and on the student card (real state)', async ({ browser, problems }) => {
  const held = await leaseWithArrears(browser, 'af-keep')
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(owner.page, problems)
  watch(student.page, problems)
  try {
    const dialog = await openEndDialog(owner.page, owner.kosId, room.roomNumber)
    await expect(dialog).toContainText(/Rp\s?[\d.]+/)
    await expect(dialog.getByRole('radio', { name: /Tetap ditagih/ })).toBeChecked() // the safe option is the default
    await dialog.getByRole('button', { name: 'Akhiri sewa', exact: true }).click()
    await expect(owner.page.getByText(/Sewa diakhiri\. Tunggakan Rp\s?[\d.]+ tetap tercatat sebagai tunggakan penyewa lama\./)).toBeVisible()

    await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}&tab=tindakan`)
    const former = owner.page.getByTestId('former-arrears-section')
    await expect(former).toContainText('Tunggakan penyewa lama')
    await expect(former).toContainText(`Kamar ${room.roomNumber}`)

    await student.page.goto('/my-kos')
    const card = student.page.getByTestId('tenancy-card')
    await expect(card).toHaveAttribute('data-status', 'ENDED')
    await expect(card.getByText('Selesai · Ada tunggakan')).toBeVisible()
    await expect(card.getByRole('row').filter({ hasText: 'Terlambat' })).toHaveCount(1)
    expectHttpErrors(problems)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('SIM-001 end lease, WAIVE: a reason is required, then the student row reads "Dihapus pemilik" (real state)', async ({ browser, problems }) => {
  const held = await leaseWithArrears(browser, 'af-waive')
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(owner.page, problems)
  watch(student.page, problems)
  try {
    const dialog = await openEndDialog(owner.page, owner.kosId, room.roomNumber)
    await dialog.getByRole('radio', { name: /Hapus tunggakan/ }).check()
    const submit = dialog.getByRole('button', { name: 'Hapus tunggakan dan akhiri sewa' })
    await submit.click()
    await expect(dialog.getByText('Tulis alasan minimal 5 karakter.')).toBeVisible()
    const [{ status }] = await sql<{ status: string }>('SELECT status FROM "Tenancy" WHERE id = $1', [held.tenancyId])
    expect(status).toBe('ACTIVE') // a refused submit changes nothing

    await dialog.getByLabel('Alasan penghapusan').fill('Penyewa pindah kota, disepakati bersama')
    await submit.click()
    await expect(owner.page.getByRole('alertdialog')).toHaveCount(0)
    await expect.poll(async () => (await sql<{ status: string }>('SELECT status FROM "Tenancy" WHERE id = $1', [held.tenancyId]))[0].status).toBe('ENDED')

    await student.page.goto('/my-kos')
    const card = student.page.getByTestId('tenancy-card')
    await expect(card.getByRole('row').filter({ hasText: 'Dihapus pemilik' })).toHaveCount(1)
    await expect(card.getByText('Selesai · Ada tunggakan')).toHaveCount(0)
    expectHttpErrors(problems)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('SIM-006 reject with a reason: the student reads the reason, the owner note and a next step (real state)', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'af-rej-own', rooms: 1 })
  const student = await newStudent(browser, { label: 'af-rej-stu' })
  watch(owner.page, problems)
  watch(student.page, problems)
  try {
    await apply(student, owner.rooms[0].id)
    await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}&tab=tindakan`)
    await owner.page.getByRole('button', { name: 'Tolak', exact: true }).click()
    const dialog = owner.page.getByRole('dialog', { name: 'Tolak pengajuan?' })
    // The reason is required: submitting without one stays open and says so.
    await dialog.getByRole('button', { name: 'Tolak Pengajuan' }).click()
    await expect(dialog.getByText('Pilih alasan penolakan.')).toBeVisible()
    await dialog.getByRole('radio', { name: 'Kamar tidak tersedia' }).check()
    await dialog.getByLabel('Catatan untuk pengaju (opsional)').fill('Kamar sedang direnovasi')
    await dialog.getByRole('button', { name: 'Tolak Pengajuan' }).click()
    await expect(dialog).toHaveCount(0)

    await student.page.goto('/my-kos')
    await student.page.getByRole('tab', { name: /Pengajuan Sewa/ }).click()
    const card = student.page.getByTestId('application-card')
    await expect(card).toContainText('Alasan: Kamar ini tidak tersedia untuk tanggal yang Anda ajukan.')
    await expect(card).toContainText('Catatan pemilik: “Kamar sedang direnovasi”')
    const next = card.getByRole('link', { name: /^Cari kos lain/ })
    await expect(next).toBeVisible()
    await expect(next).toHaveAttribute('href', /^\/search/)
    expectHttpErrors(problems)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('SIM-011 a demo listing opened by direct link: banner, a way to real kos, no booking button (stub of kos.detail)', async ({ page }) => {
  // e2e runs with DEMO_ISOLATION=0, so the server never marks anything demoBlocked here; the server filter has backend integration tests.
  await page.route('**/api/trpc/kos.detail*', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    body.result.data.demoBlocked = true
    body.result.data.isDemoListing = true
    await route.fulfill({ response: res, json: body })
  })
  await page.goto('/kos/kos-1')
  const banner = page.getByTestId('demo-listing-banner')
  await expect(banner).toContainText('Kos contoh (demo)')
  await expect(banner.getByRole('link', { name: /^Cari kos sungguhan/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ajukan Sewa' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Kamar Saat Ini Terisi' })).toHaveCount(0)
})

test('search never claims "no results" or "0 shown" while the request is still pending (delayed kos.search)', async ({ page }) => {
  await page.route('**/api/trpc/kos.search*', async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
  await page.goto('/search')
  const empty = page.getByText('Tidak ada kos yang cocok')
  const zero = page.getByText(/Menampilkan\s+0\b/)
  await expect(page.getByText('Memuat daftar kos…')).toBeVisible()
  for (let i = 0; i < 8; i++) {
    expect(await empty.count(), 'empty state while pending').toBe(0)
    expect(await zero.count(), '"Menampilkan 0" while pending').toBe(0)
    await page.waitForTimeout(100)
  }
  await expect(page.getByText(/Menampilkan\s+[1-9]\d*\s+pilihan/)).toBeVisible({ timeout: 10_000 })
  await expect(empty).toHaveCount(0)
})

test('sign-up: the email code field has focus on arrival, so typing the code at once keeps its first digit (real state)', async ({ page }) => {
  await ownIp(page)
  const email = `af-otp-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  await page.goto('/masuk')
  const form = page.locator('main')
  await form.getByRole('button', { name: 'Daftar baru' }).click()
  await form.getByLabel('Nama Lengkap').fill('Calon Mahasiswa')
  await form.getByLabel('Email').fill(email)
  await form.getByLabel('Kata Sandi', { exact: true }).fill('Sandi-rahasia-123')
  await form.getByLabel(/Saya menyetujui/).check()
  await form.getByRole('button', { name: 'Daftar Sekarang' }).click()
  await expect(page).toHaveURL(/langkah=2/)
  await expect(form.getByText(`Masukkan kode 6 digit yang kami kirim ke ${email}`)).toBeVisible()
  const code = await outboxCode(email, 'verify-email')
  await expect(form.getByLabel('Kode verifikasi')).toBeFocused()
  await page.keyboard.type(code) // no click first
  await expect(form.getByLabel('Kode verifikasi')).toHaveValue(code)
})

test('profile: the bill-reminder checkbox confirms each change with a toast (real state)', async ({ browser, problems }) => {
  const student = await newStudent(browser, { label: 'af-remind' })
  watch(student.page, problems)
  try {
    await student.page.goto('/profile/notifikasi')
    const box = student.page.getByRole('checkbox', { name: /Kirim pengingat/ })
    await expect(box).toBeChecked()
    // A controlled checkbox only flips after the server answered, so click and then assert (check()/uncheck() would object).
    await box.click()
    await expect(student.page.getByText('Pengingat dimatikan.')).toBeVisible()
    await expect(box).not.toBeChecked()
    await box.click()
    await expect(student.page.getByText('Pengingat dinyalakan.')).toBeVisible()
    await expect(box).toBeChecked()
    expectHttpErrors(problems)
  } finally {
    await student.ctx.close()
  }
})

test('the tenant name on the owner board opens the tenant profile and the opening is logged (real state)', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'af-prof' })
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(owner.page, problems)
  try {
    const before = await sql('SELECT id FROM "TenantProfileView" WHERE "kosId" = $1 AND "tenantUserId" = $2', [owner.kosId, student.userId])
    expect(before).toHaveLength(0)
    await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}`)
    await boardRow(owner.page, room.roomNumber).getByRole('button', { name: `Lihat profil penyewa Kamar ${room.roomNumber}` }).click()
    const dialog = owner.page.getByRole('dialog', { name: 'Profil penyewa' })
    await expect(dialog.getByTestId('tenant-profile')).toBeVisible()
    await expect(dialog).toContainText('Penguji E2E')
    // TenantProfileView is what the student's profileViewsOfMe reads: opening the profile must leave one row for this owner and kos.
    await expect.poll(async () => (await sql('SELECT id FROM "TenantProfileView" WHERE "kosId" = $1 AND "tenantUserId" = $2 AND "ownerUserId" = $3', [owner.kosId, student.userId, owner.userId])).length).toBe(1)
    expectHttpErrors(problems)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('/kos/:id?room=<id> preselects that room: "Ajukan Sewa" goes to checkout with it (real state)', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'af-room-own', rooms: 2 })
  const student = await newStudent(browser, { label: 'af-room-stu', campus: true })
  watch(student.page, problems)
  const page = student.page
  const checkoutRoom = async (path: string) => {
    await page.goto(path)
    await page.getByRole('button', { name: 'Ajukan Sewa' }).click()
    await page.waitForURL(/\/checkout\//)
    return new URL(page.url()).searchParams.get('room')
  }
  try {
    // Without ?room the page picks the first bookable room; the shared link must then override it, whichever that is.
    const byDefault = await checkoutRoom(`/kos/${owner.kosId}`)
    expect(owner.rooms.map((r) => r.id)).toContain(byDefault)
    const other = owner.rooms.find((r) => r.id !== byDefault)!
    expect(await checkoutRoom(`/kos/${owner.kosId}?room=${encodeURIComponent(other.id)}`)).toBe(other.id)
    // The picker shows a selected type for the preselected room.
    await page.goto(`/kos/${owner.kosId}?room=${encodeURIComponent(other.id)}`)
    await expect(page.locator('.room-picker__option[aria-pressed="true"]')).toHaveCount(1)
    expectHttpErrors(problems)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})
