import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import {
  ageAttempt,
  expectHttpErrors,
  latestPayment,
  newContext,
  newOwnerWorld,
  newStudent,
  sessionCompleted,
  sql,
  stubXenditCheckout,
  tick,
  trpcPost,
  watch,
  webhook,
  wibDate,
  xendit,
} from './seams'

// Full unbroken multi-actor E2E journeys across the real user workflow:
//   Kos Detail -> Ajukan Sewa (/checkout) -> Pemilik Kos Accepts (/owner/dashboard) -> Student Pays (Xendit) -> Active Tenancy & Kuitansi
// Every test constructs an isolated owner, kos, rooms, and student(s) in separate BrowserContexts so parallel workers never collide.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const PASSWORD = 'Sandi-rahasia-123'
const CHECKOUT_HOST = /^https:\/\/checkout-staging\.xendit\.co\//
const RECEIPT_NO = /^KB\/\d{4}\/\d{2}\/\d{4}$/

const digits = (text: string | null) => Number((text ?? '').replace(/\D/g, ''))
const closeAll = (...ctxs: BrowserContext[]) => Promise.all(ctxs.map((c) => c.close()))
const boardRow = (page: Page, roomNumber: string) => page.getByRole('row').filter({ hasText: `Kamar ${roomNumber}` })
const invoiceRow = (page: Page, month: number) => page.getByRole('row').filter({ hasText: `Bulan ${month} ·` })

test('full workflow: kos detail -> ajukan sewa -> owner accepts -> Xendit checkout & live webhook polling -> active rental, locked rent, and kuitansi', async ({ browser, problems }) => {
  test.setTimeout(60_000)
  const RENT = 1_500_000
  const DISCOUNT = 100_000
  const APP_FEE = 25_000
  const FIRST_INVOICE = RENT + APP_FEE - DISCOUNT // 1.425.000
  const LEASE_TOTAL = FIRST_INVOICE + 2 * RENT // 4.425.000 (3 months)

  const owner = await newOwnerWorld(browser, { label: 'e2e-full-own', rooms: 2, price: RENT, discount: DISCOUNT })
  const student = await newStudent(browser, { label: 'e2e-full-stu', campus: true })
  await stubXenditCheckout(student.ctx)
  watch(student.page, problems)
  watch(owner.page, problems)

  const room = owner.rooms[0]
  const note = `Rencana masuk semester 4 (${Date.now()})`
  let invoiceId = ''
  let tenancyId = ''
  let paymentId = ''

  try {
    await test.step('1. Student opens kos detail, picks 3-month lease, checks discounted quote, and clicks Ajukan Sewa', async () => {
      await student.page.goto(`/kos/${owner.kosId}`)
      await expect(student.page.getByRole('heading', { level: 1, name: owner.kosName })).toBeVisible()
      await expect(student.page.locator('.room-picker__option')).toContainText('2 dari 2 kamar tersedia')

      await student.page.getByRole('group', { name: 'Durasi sewa' }).getByRole('button', { name: '3 Bulan' }).click()
      // Wait for async campus.myDiscountStatus to settle before asserting the discounted total.
      // Audit 2026-11-24: the signed-in eligible price now also reads "Harga Anda: Rp ... (Diskon Kampus Mitra)", so name the line.
      await expect(student.page.getByTestId('sidebar-price-eligible')).toContainText('Diskon Kampus Mitra')
      await expect.poll(async () => digits(await student.page.getByTestId('sidebar-lease-total').textContent())).toBe(LEASE_TOTAL)

      await student.page.getByRole('button', { name: 'Ajukan Sewa' }).click()
      await expect(student.page).toHaveURL(new RegExp(`/checkout/${owner.kosId}\\?room=${room.id}&duration=3`))
    })

    await test.step('2. Student checks first-month price parity and submits rental application on /checkout', async () => {
      await expect(student.page.locator('aside').getByText('Diskon Kampus Mitra', { exact: true })).toBeVisible()
      const totalRow = student.page.getByText('Total perkiraan', { exact: true }).locator('xpath=../..')
      await expect.poll(async () => digits(await totalRow.textContent())).toBe(FIRST_INVOICE)
      await expect(student.page.getByLabel('Durasi Sewa')).toHaveValue('3')

      await student.page.getByLabel('Tanggal Mulai Sewa').fill(wibDate(3))
      await student.page.getByLabel('Jurusan').fill('Teknik Informatika')
      await student.page.getByLabel('Semester').fill('4')
      await student.page.getByLabel(/Catatan untuk pemilik/).fill(note)
      await student.page.getByRole('button', { name: 'Kirim Pengajuan' }).click()

      await expect(student.page.getByRole('heading', { name: 'Pengajuan Terkirim' })).toBeVisible()
      await expect(student.page.getByText('Kamar belum ditahan dan Anda belum perlu membayar sebelum pengajuan diterima.')).toBeVisible()

      await student.page.getByRole('link', { name: 'Pantau Pengajuan' }).click()
      await expect(student.page).toHaveURL(/\/my-kos/)
      await expect(student.page.getByRole('tab', { name: 'Pengajuan Sewa (1)' })).toHaveAttribute('aria-selected', 'true')
      const appCard = student.page.getByTestId('application-card').filter({ hasText: owner.kosName })
      await expect(appCard).toContainText('Menunggu Pemilik')
      await expect(appCard).toContainText(`Kamar ${room.roomNumber}`)

      // Application must create zero money or hold records.
      expect(await sql('SELECT id FROM "Tenancy" WHERE "roomId" = $1', [room.id])).toHaveLength(0)
      expect(await sql('SELECT i.id FROM "Invoice" i JOIN "Tenancy" t ON t.id = i."tenancyId" WHERE t."roomId" = $1', [room.id])).toHaveLength(0)
    })

    await test.step('3. Owner reviews and accepts the application in /owner/dashboard -> 24h hold + Invoice #1 only', async () => {
      await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}`)
      await expect(boardRow(owner.page, room.roomNumber).getByText('Kosong', { exact: true })).toBeVisible()

      await owner.page.getByRole('tab', { name: /Perlu tindakan/ }).click()
      const row = owner.page.getByTestId('owner-application').filter({ hasText: note })
      await expect(row).toContainText('Penguji E2E')
      await expect(row).toContainText(`Kamar ${room.roomNumber}`)
      await expect(row).toContainText('3 bulan')
      await expect(row).toContainText('Mahasiswa terverifikasi')
      await expect(row).toContainText('Teknik Informatika · Semester 4')

      await row.getByRole('button', { name: 'Terima' }).click()
      const dialog = owner.page.getByRole('dialog')
      await expect(dialog).toContainText('Terima pengajuan?')
      await expect(dialog).toContainText('Kamar akan ditahan 24 jam')
      await dialog.getByRole('button', { name: 'Terima Pengajuan' }).click()
      await expect(row).toHaveCount(0)

      await owner.page.getByRole('tab', { name: 'Ringkasan' }).click()
      const r = boardRow(owner.page, room.roomNumber)
      await expect(r.getByText('Dipesan', { exact: true })).toBeVisible()
      await expect(r.getByTestId('payment-label')).toHaveCount(0)

      // Verify atomic DB obligation: 1 PENDING tenancy (~24h), 1 UNPAID invoice snapshot, 0 payments.
      const [t] = await sql<{ id: string; status: string; agreedMonthlyRent: number; hours: number }>(
        `SELECT id, status, "agreedMonthlyRent", extract(epoch FROM ("expiresAt" - now())) / 3600 AS hours
           FROM "Tenancy" WHERE "roomId" = $1`,
        [room.id],
      )
      expect(t.status).toBe('PENDING')
      expect(t.agreedMonthlyRent).toBe(RENT)
      expect(Number(t.hours)).toBeGreaterThan(23.5)
      tenancyId = t.id

      const invoices = await sql<{ id: string; status: string; amount: number; rentAmount: number; discountAmount: number; applicationFeeAmount: number; ownerReceivableAmount: number }>(
        'SELECT id, status, amount, "rentAmount", "discountAmount", "applicationFeeAmount", "ownerReceivableAmount" FROM "Invoice" WHERE "tenancyId" = $1',
        [tenancyId],
      )
      expect(invoices).toHaveLength(1)
      expect(invoices[0]).toMatchObject({
        status: 'UNPAID',
        amount: FIRST_INVOICE,
        rentAmount: RENT,
        discountAmount: DISCOUNT,
        applicationFeeAmount: APP_FEE,
        ownerReceivableAmount: RENT - DISCOUNT,
      })
      invoiceId = invoices[0].id
      expect(await sql('SELECT id FROM "Payment" WHERE "invoiceId" = $1', [invoiceId])).toHaveLength(0)
    })

    await test.step('4. Owner hikes room rent mid-hold; student starts Xendit checkout -> owner sees AWAITING_ONLINE lockout', async () => {
      // Hike live room price before settlement to prove Months 2 & 3 use the agreedMonthlyRent snapshot.
      await trpcPost(owner.ctx, 'owner.room.update', {
        kosId: owner.kosId,
        roomId: room.id,
        roomNumber: room.roomNumber,
        floor: 1,
        type: 'Standar',
        size: '3 x 3 m',
        bedType: 'Single Bed',
        priceMonthly: 2_100_000,
      })

      await student.page.reload()
      await expect(student.page.getByRole('tab', { name: 'Kamar yang Disewa (1)' })).toHaveAttribute('aria-selected', 'true')
      const card = student.page.getByTestId('tenancy-card').filter({ hasText: owner.kosName })
      await expect(card).toHaveAttribute('data-status', 'PENDING')
      await expect(card).toContainText('Menunggu Pembayaran')
      await expect(card).toContainText('Kamar ditahan sampai')

      const m1 = invoiceRow(student.page, 1)
      await expect(m1).toContainText('1.425.000')
      await expect(m1).toContainText('Belum dibayar')
      await m1.getByRole('button', { name: 'Bayar Sekarang' }).click()

      await student.page.waitForURL(CHECKOUT_HOST)
      const attempt = await latestPayment(invoiceId)
      expect(attempt).toMatchObject({ provider: 'XENDIT', status: 'PENDING', amount: FIRST_INVOICE })
      paymentId = attempt.id

      // Explicit reload on owner board (board polls every 45s) -> manual payment must be locked while online attempt is live.
      await owner.page.reload()
      const r = boardRow(owner.page, room.roomNumber)
      await expect(r.getByTestId('payment-label')).toHaveText('Penyewa sedang membayar online')
      await expect(owner.page.getByRole('button', { name: `Tandai Lunas Kamar ${room.roomNumber}` })).toBeDisabled()

      // Student returns with ?result=success -> client MUST wait and NOT claim payment before webhook.
      await student.page.getByRole('link', { name: 'Bayar (simulasi)' }).click()
      await student.page.waitForURL(/\/my-kos\?payment=.*&result=success/)
      await expect(invoiceRow(student.page, 1).getByRole('status')).toHaveText('Menunggu konfirmasi pembayaran…')
      await expect(invoiceRow(student.page, 1)).toContainText('Menunggu konfirmasi') // SIM-016: replaces "Belum dibayar" while the returned payment is awaited
      await expect(invoiceRow(student.page, 1)).not.toContainText('Lunas')
    })

    await test.step('5. Signed Xendit webhook settles -> student page auto-updates via live 3s polling without reload', async () => {
      const payload = sessionCompleted(paymentId, FIRST_INVOICE)
      const firstDelivery = await webhook(student.page.request, payload)
      expect(firstDelivery).toEqual({ status: 200, json: { ok: true, result: 'SETTLED' } })

      // Identical redelivery is deduped by fingerprint; a newer timestamp hits settlement's DUPLICATE guard.
      const dupFingerprint = await webhook(student.page.request, payload)
      expect(dupFingerprint).toEqual({ status: 200, json: { ok: true, result: 'DUPLICATE_DELIVERY' } })
      const newerPayload = { ...payload, data: { ...payload.data, updated: new Date(Date.now() + 60_000).toISOString() } }
      const dupSettle = await webhook(student.page.request, newerPayload)
      expect(dupSettle).toEqual({ status: 200, json: { ok: true, result: 'DUPLICATE' } })

      // No page.reload(): InvoicePaymentActions polls payment.status every 3s, refreshes booking.mine, and clears query params.
      const card = student.page.getByTestId('tenancy-card').filter({ hasText: owner.kosName })
      await expect(card).toHaveAttribute('data-status', 'ACTIVE', { timeout: 15_000 })
      await expect(student.page).toHaveURL(/\/my-kos$/)
      await expect(card.getByText('Sewa Aktif', { exact: true })).toBeVisible()

      await expect(card.getByRole('row')).toHaveCount(3)
      await expect(invoiceRow(student.page, 1)).toContainText('Lunas')
      await expect(invoiceRow(student.page, 1).getByRole('button', { name: /Bayar Sekarang|Lanjutkan Pembayaran|Periksa Status/ })).toHaveCount(0)
      await expect(invoiceRow(student.page, 1).getByRole('link', { name: RECEIPT_NO })).toBeVisible()

      // Months 2 & 3 must reflect the locked Rp 1.500.000 rent (NOT the Rp 2.100.000 hike) with no fee/discount.
      await expect(invoiceRow(student.page, 2)).toContainText('1.500.000')
      await expect(invoiceRow(student.page, 2)).toContainText('Belum dibayar')
      await expect(invoiceRow(student.page, 3)).toContainText('1.500.000')
      await expect(invoiceRow(student.page, 3)).toContainText('Belum dibayar')
      await expect(card).not.toContainText('2.100.000')
    })

    await test.step('6. Owner board, dual-side Kuitansi, email outbox, and kos detail availability all match', async () => {
      // Owner board reflects verified Xendit settlement.
      await owner.page.reload()
      const r = boardRow(owner.page, room.roomNumber)
      await expect(r.getByText('Lunas', { exact: true })).toBeVisible()
      await expect(r.getByTestId('payment-label')).toHaveText('Pembayaran terverifikasi')

      // Student opens Kuitansi.
      await student.page.getByRole('link', { name: 'Lihat Kuitansi Resmi' }).click()
      await expect(student.page.getByTestId('kuitansi-no')).toHaveText(RECEIPT_NO)
      const receiptNo = (await student.page.getByTestId('kuitansi-no').textContent())!
      await expect(student.page.getByText('LUNAS', { exact: true })).toBeVisible()
      await expect(student.page.getByText('Pembayaran online terverifikasi (Xendit)')).toBeVisible()
      await expect(student.page.getByRole('term').filter({ hasText: 'Diskon Kampus Mitra' })).toBeVisible()
      await expect(student.page.getByRole('link', { name: 'Kembali ke Kos Saya' })).toHaveAttribute('href', '/my-kos')

      // Owner opens the exact same Kuitansi from the board.
      await r.getByRole('link', { name: `Lihat kuitansi Kamar ${room.roomNumber}` }).click()
      await expect(owner.page.getByTestId('kuitansi-no')).toHaveText(receiptNo)
      await expect(owner.page.getByText('LUNAS', { exact: true })).toBeVisible()
      await expect(owner.page.getByText('Pembayaran online terverifikasi (Xendit)')).toBeVisible()
      await expect(owner.page.getByRole('link', { name: 'Kembali ke Papan Okupansi' })).toHaveAttribute('href', '/owner/dashboard')

      // Both settlement emails exist in EmailOutbox (status agnostic so the 15s outbox worker never races this check).
      await expect
        .poll(async () => (await sql('SELECT id FROM "EmailOutbox" WHERE "to" = $1 AND template = $2', [student.email, 'payment-received'])).length)
        .toBe(1)
      await expect
        .poll(async () => (await sql('SELECT id FROM "EmailOutbox" WHERE "to" = $1 AND template = $2', [owner.email, 'payment-received-owner'])).length)
        .toBe(1)

      // Public kos detail reflects the occupied room (2 -> 1 vacant).
      await student.page.goto(`/kos/${owner.kosId}`)
      await expect(student.page.locator('.room-picker__option')).toContainText('1 dari 2 kamar tersedia')
    })

    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('full workflow recovery: signed-out visitor -> sign-in redirect -> apply -> accept -> Xendit cancel -> instant same-page resume -> lost-webhook sweep auto-settle', async ({ browser, problems }) => {
  test.setTimeout(60_000)
  const owner = await newOwnerWorld(browser, { label: 'e2e-rec-own', rooms: 1, price: 1_200_000 })
  const account = await newStudent(browser, { label: 'e2e-rec-stu' })
  const visitor = await newContext(browser)
  await stubXenditCheckout(visitor.ctx)
  watch(visitor.page, problems)
  watch(owner.page, problems)

  const room = owner.rooms[0]
  const note = `Pemulihan pembayaran (${Date.now()})`
  let invoiceId = ''
  let paymentId = ''

  try {
    await test.step('1. Signed-out visitor starts on kos detail, redirects through /masuk?next= back to checkout, and applies', async () => {
      await visitor.page.goto(`/kos/${owner.kosId}`)
      await expect(visitor.page.locator('.room-picker__option')).toContainText('1 dari 1 kamar tersedia')
      await visitor.page.getByRole('button', { name: 'Ajukan Sewa' }).click()
      await expect(visitor.page).toHaveURL(new RegExp(`/checkout/${owner.kosId}\\?room=${room.id}`))

      await visitor.page.getByRole('button', { name: 'Masuk untuk Mengajukan' }).click()
      await expect(visitor.page).toHaveURL(/\/masuk\?next=/)

      const form = visitor.page.locator('main')
      await form.getByLabel('Email').fill(account.email)
      await form.getByLabel('Kata Sandi', { exact: true }).fill(PASSWORD)
      await form.getByRole('button', { name: 'Masuk ke Akun' }).click()

      // Redirects back to the exact checkout URL with the selected room intact.
      await expect(visitor.page).toHaveURL(new RegExp(`/checkout/${owner.kosId}\\?room=${room.id}`))
      await expect(visitor.page.getByText(account.email)).toBeVisible()

      await visitor.page.getByLabel('Jurusan').fill('Sistem Informasi')
      await visitor.page.getByLabel(/Catatan untuk pemilik/).fill(note)
      await visitor.page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
      await expect(visitor.page.getByRole('heading', { name: 'Pengajuan Terkirim' })).toBeVisible()
    })

    await test.step('2. Owner accepts via dashboard UI', async () => {
      await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}&tab=tindakan`)
      const row = owner.page.getByTestId('owner-application').filter({ hasText: note })
      await row.getByRole('button', { name: 'Terima' }).click()
      await owner.page.getByRole('dialog').getByRole('button', { name: 'Terima Pengajuan' }).click()
      await expect(row).toHaveCount(0)

      const [{ id }] = await sql<{ id: string }>(
        'SELECT i.id FROM "Invoice" i JOIN "Tenancy" t ON t.id = i."tenancyId" WHERE t."roomId" = $1',
        [room.id],
      )
      invoiceId = id
    })

    await test.step('3. Student cancels Xendit checkout -> instant same-page Lanjutkan Pembayaran reuses the exact same session', async () => {
      await visitor.page.goto('/my-kos')
      await invoiceRow(visitor.page, 1).getByRole('button', { name: 'Bayar Sekarang' }).click()
      await visitor.page.waitForURL(CHECKOUT_HOST)
      const firstCheckoutUrl = visitor.page.url()
      const attempt = await latestPayment(invoiceId)
      paymentId = attempt.id

      // Cancel returns to /my-kos?payment=...&result=cancel -> clears URL & shows Lanjutkan Pembayaran immediately with no lockout.
      await visitor.page.getByRole('link', { name: 'Batalkan' }).click()
      await expect(visitor.page).toHaveURL(/\/my-kos$/)
      await expect(visitor.page.getByText(/Pembayaran dibatalkan/)).toBeVisible()
      const resumeBtn = invoiceRow(visitor.page, 1).getByRole('button', { name: 'Lanjutkan Pembayaran' })
      await expect(resumeBtn).toBeVisible()
      await expect(invoiceRow(visitor.page, 1).getByText('Menunggu konfirmasi pembayaran…')).toHaveCount(0)

      await resumeBtn.click()
      await visitor.page.waitForURL(CHECKOUT_HOST)
      expect(visitor.page.url()).toBe(firstCheckoutUrl)
      expect(await sql('SELECT id FROM "Payment" WHERE "invoiceId" = $1', [invoiceId])).toHaveLength(1)
    })

    await test.step('4. Webhook is lost -> background sweep recovers from provider and live polling settles the UI', async () => {
      await visitor.page.getByRole('link', { name: 'Bayar (simulasi)' }).click()
      await visitor.page.waitForURL(/\/my-kos\?payment=.*&result=success/)
      await expect(invoiceRow(visitor.page, 1).getByRole('status')).toHaveText('Menunggu konfirmasi pembayaran…')
      // Audit 2026-11-24 (SIM-016): while waiting for a returned payment the row status reads "Menunggu konfirmasi", not "Belum dibayar".
      await expect(invoiceRow(visitor.page, 1)).toContainText('Menunggu konfirmasi')
      await expect(invoiceRow(visitor.page, 1)).not.toContainText('Belum dibayar')

      // No webhook is sent: simulate provider COMPLETED + age past 10m grace period + background sweep tick.
      await xendit.session(visitor.page, paymentId, 'COMPLETED')
      await ageAttempt(paymentId, 11)
      await tick(visitor.page, 'sweep')

      // Live 3s poll transitions UI automatically to ACTIVE + Lunas without manual reload.
      const card = visitor.page.getByTestId('tenancy-card').filter({ hasText: owner.kosName })
      await expect(card).toHaveAttribute('data-status', 'ACTIVE', { timeout: 15_000 })
      await expect(invoiceRow(visitor.page, 1)).toContainText('Lunas')
      await expect(visitor.page).toHaveURL(/\/my-kos$/)

      // Owner board shows Lunas + verified, and the kos detail now shows 0 vacant + waitlist join card.
      await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}`)
      const r = boardRow(owner.page, room.roomNumber)
      await expect(r.getByText('Lunas', { exact: true })).toBeVisible()
      await expect(r.getByTestId('payment-label')).toHaveText('Pembayaran terverifikasi')

      await visitor.page.goto(`/kos/${owner.kosId}`)
      await expect(visitor.page.locator('.room-picker__option')).toContainText('0 dari 1 kamar tersedia')
      await expect(visitor.page.getByTestId('waitlist-join')).toContainText('Anda sudah menyewa kamar di kos ini')
    })

    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, account.ctx, visitor.ctx)
  }
})
