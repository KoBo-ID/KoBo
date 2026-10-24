import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { expireAttempt, expireHold, heldRoom, newOwnerWorld, shiftDueDates, sql, trpcPost, trpcRaw, watch, expectHttpErrors, type HeldRoom } from './seams'

// The owner records money that arrived outside the app ("Tandai Lunas") and sends billing reminders.
// Demo-account restriction does not apply: payment.recordManual has no isDemo check, so there is nothing to refuse.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const FIRST_INVOICE = 1_525_000 // 1.500.000 rent + 25.000 application fee, no campus discount

const openBoard = (page: Page, kosId: string) => page.goto(`/owner/dashboard?kos=${kosId}`)
const boardRow = (page: Page, roomNumber: string) => page.getByRole('row').filter({ hasText: `Kamar ${roomNumber}` })
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text })

async function openPayModal(page: Page, roomNumber: string) {
  await page.getByRole('button', { name: `Tandai Lunas Kamar ${roomNumber}` }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(`Tandai Lunas Kamar ${roomNumber}`)
  return dialog
}

async function recordViaApi(held: HeldRoom, over: Record<string, unknown> = {}) {
  return trpcRaw(held.owner.ctx, 'payment.recordManual', { kosId: held.owner.kosId, invoiceId: held.invoiceId, method: 'CASH', confirmedAmount: FIRST_INVOICE, ...over })
}

const invoiceStatuses = async (tenancyId: string) =>
  (await sql<{ status: string }>('SELECT status FROM "Invoice" WHERE "tenancyId" = $1 ORDER BY "dueDate"', [tenancyId])).map((r) => r.status)

test('scenario 22: cash — the amount must be re-typed exactly, then the rental is active with a receipt', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'cash' })
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(owner.page, problems)
  try {
    await openBoard(owner.page, owner.kosId)
    await expect(boardRow(owner.page, room.roomNumber).getByText('Dipesan', { exact: true })).toBeVisible()
    const dialog = await openPayModal(owner.page, room.roomNumber)
    const submit = dialog.getByRole('button', { name: 'Catat Lunas' })
    const amount = dialog.getByLabel(/Ketik jumlah yang diterima/)

    await test.step('the form shows the invoice amount and refuses a different number', async () => {
      await expect(amount).toBeVisible()
      await expect(dialog.getByText(/Ketik jumlah yang diterima \(Rp.*1\.525\.000\)/)).toBeVisible()
      await expect(dialog.getByLabel('Tunai')).toBeChecked()
      await expect(submit).toBeDisabled()
      await amount.fill('1500000')
      await expect(dialog.getByText('Jumlah harus sama persis dengan tagihan.')).toBeVisible()
      await expect(submit).toBeDisabled()
      await amount.fill('1525000')
      await expect(dialog.getByText('Jumlah harus sama persis dengan tagihan.')).toHaveCount(0)
      await expect(submit).toBeEnabled()
    })

    await test.step('recording it confirms with a toast and flips the board row to Lunas', async () => {
      await dialog.getByLabel(/Catatan/).fill('Diterima langsung di kos')
      await submit.click()
      await expect(toast(owner.page, 'Pembayaran dicatat lunas. Kuitansi sudah terbit.')).toBeVisible()
      await expect(dialog).toHaveCount(0)
      const row = boardRow(owner.page, room.roomNumber)
      await expect(row.getByText('Lunas', { exact: true })).toBeVisible()
      await expect(row.getByTestId('payment-label')).toHaveText('Dicatat manual')
      await expect(row.getByRole('link', { name: `Lihat kuitansi Kamar ${room.roomNumber}` })).toBeVisible()
    })

    await test.step('the database holds one audited MANUAL payment and an active rental', async () => {
      const payments = await sql<{ provider: string; status: string; amount: number; manualMethod: string; manualNote: string; recordedById: string }>(
        'SELECT provider, status, amount, "manualMethod", "manualNote", "recordedById" FROM "Payment" WHERE "invoiceId" = $1', [held.invoiceId])
      expect(payments).toEqual([{ provider: 'MANUAL', status: 'PAID', amount: FIRST_INVOICE, manualMethod: 'CASH', manualNote: 'Diterima langsung di kos', recordedById: owner.userId }])
      const [tenancy] = await sql<{ status: string }>('SELECT status FROM "Tenancy" WHERE id = $1', [held.tenancyId])
      expect(tenancy.status).toBe('ACTIVE')
      expect(await invoiceStatuses(held.tenancyId)).toEqual(['PAID', 'UNPAID', 'UNPAID'])
    })

    await test.step('the student sees Lunas, an active rental and the receipt', async () => {
      await student.page.goto('/my-kos')
      const card = student.page.getByTestId('tenancy-card').filter({ hasText: owner.kosName })
      await expect(card).toHaveAttribute('data-status', 'ACTIVE')
      await expect(card.getByText('Sewa Aktif')).toBeVisible()
      const first = card.getByRole('row').filter({ hasText: 'Bulan 1' })
      await expect(first).toContainText('Lunas')
      await expect(first.getByRole('button', { name: 'Bayar Sekarang' })).toHaveCount(0)
      await expect(first.getByRole('link', { name: /^KB\/\d{4}\/\d{2}\/\d{4}$/ })).toBeVisible()
    })

    await test.step('recording the same invoice again is refused', async () => {
      const again = await recordViaApi(held)
      expect([again.status, again.message]).toEqual([409, 'Tagihan ini sudah lunas.'])
      expect(await sql('SELECT id FROM "Payment" WHERE "invoiceId" = $1', [held.invoiceId])).toHaveLength(1)
    })

    await test.step('the kuitansi names the method', async () => {
      await boardRow(owner.page, room.roomNumber).getByRole('link', { name: `Lihat kuitansi Kamar ${room.roomNumber}` }).click()
      await expect(owner.page.getByTestId('kuitansi-no')).toHaveText(/^KB\/\d{4}\/\d{2}\/\d{4}$/)
      await expect(owner.page.getByText('Tunai, dicatat oleh pemilik')).toBeVisible()
    })
    expectHttpErrors(problems, 409)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('scenario 22: bank transfer needs a valid reference, which the kuitansi keeps', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'bank' })
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(owner.page, problems)
  try {
    await openBoard(owner.page, owner.kosId)
    const dialog = await openPayModal(owner.page, room.roomNumber)
    const submit = dialog.getByRole('button', { name: 'Catat Lunas' })
    await expect(dialog.getByLabel('Nomor referensi transfer')).toHaveCount(0)

    await dialog.getByLabel(/Ketik jumlah yang diterima/).fill('Rp 1.525.000')
    await expect(submit).toBeEnabled()
    await dialog.getByLabel('Transfer bank').check()
    const reference = dialog.getByLabel('Nomor referensi transfer')
    await expect(dialog.getByText('Wajib untuk transfer bank.')).toBeVisible()
    await expect(submit).toBeDisabled()

    await test.step('a malformed reference is explained', async () => {
      await reference.fill('!!')
      await expect(dialog.getByText('Gunakan 3-64 karakter: huruf, angka, spasi, titik, garis miring, garis bawah, atau tanda hubung.')).toBeVisible()
      await expect(submit).toBeDisabled()
    })

    await test.step('a valid reference lets the owner record it', async () => {
      await reference.fill('TRF-OWN-001')
      await expect(submit).toBeEnabled()
      await submit.click()
      await expect(toast(owner.page, 'Pembayaran dicatat lunas. Kuitansi sudah terbit.')).toBeVisible()
      const [payment] = await sql<{ manualMethod: string; manualReference: string; manualNote: string | null; status: string }>(
        'SELECT "manualMethod", "manualReference", "manualNote", status FROM "Payment" WHERE "invoiceId" = $1', [held.invoiceId])
      expect(payment).toEqual({ manualMethod: 'BANK_TRANSFER', manualReference: 'TRF-OWN-001', manualNote: null, status: 'PAID' })
    })

    await test.step('the student opens a kuitansi that says it was a transfer', async () => {
      await student.page.goto('/my-kos')
      await student.page.getByRole('link', { name: 'Lihat Kuitansi Resmi' }).click()
      await expect(student.page.getByText('Transfer bank, dicatat oleh pemilik')).toBeVisible()
    })
    expectHttpErrors(problems)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('scenario 22: while the student has a live online attempt the owner cannot record money, and can once it lapses', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'live' })
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(owner.page, problems)
  try {
    const started = await trpcPost<{ paymentId: string }>(student.ctx, 'payment.start', { invoiceId: held.invoiceId })

    await test.step('the board says the tenant is paying and the button is disabled', async () => {
      await openBoard(owner.page, owner.kosId)
      const row = boardRow(owner.page, room.roomNumber)
      await expect(row.getByTestId('payment-label')).toHaveText('Penyewa sedang membayar online')
      await expect(owner.page.getByRole('button', { name: `Tandai Lunas Kamar ${room.roomNumber}` })).toBeDisabled()
    })

    await test.step('the server refuses it too, and nothing is recorded', async () => {
      const refused = await trpcRaw(owner.ctx, 'payment.recordManual', { kosId: owner.kosId, invoiceId: held.invoiceId, method: 'CASH', confirmedAmount: FIRST_INVOICE })
      expect([refused.status, refused.message]).toEqual([409, 'Penyewa sedang membayar secara online. Tunggu hingga sesi pembayaran berakhir.'])
      expect(await sql(`SELECT id FROM "Payment" WHERE "invoiceId" = $1 AND provider = 'MANUAL'`, [held.invoiceId])).toHaveLength(0)
      expect(await invoiceStatuses(held.tenancyId)).toEqual(['UNPAID'])
    })

    await test.step('after the session lapses the owner can record it through the modal', async () => {
      await expireAttempt(started.paymentId)
      await openBoard(owner.page, owner.kosId)
      await expect(owner.page.getByRole('button', { name: `Tandai Lunas Kamar ${room.roomNumber}` })).toBeEnabled()
      const dialog = await openPayModal(owner.page, room.roomNumber)
      await expect(dialog.getByText(/Penyewa sedang membayar secara online/)).toHaveCount(0)
      await dialog.getByLabel(/Ketik jumlah yang diterima/).fill(String(FIRST_INVOICE))
      await dialog.getByRole('button', { name: 'Catat Lunas' }).click()
      await expect(toast(owner.page, 'Pembayaran dicatat lunas. Kuitansi sudah terbit.')).toBeVisible()
      expect(await invoiceStatuses(held.tenancyId)).toEqual(['PAID', 'UNPAID', 'UNPAID'])
    })
    expectHttpErrors(problems, 409)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('scenario 22: the server refuses a wrong amount, a transfer without a reference and a lapsed hold', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'refuse' })
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(owner.page, problems)
  try {
    const wrong = await recordViaApi(held, { confirmedAmount: FIRST_INVOICE - 1 })
    expect([wrong.status, wrong.message]).toEqual([400, 'Jumlah tidak sesuai dengan tagihan.'])
    expect((await recordViaApi(held, { method: 'BANK_TRANSFER' })).status).toBe(400)
    expect((await recordViaApi(held, { method: 'BANK_TRANSFER', reference: '!!' })).status).toBe(400)
    expect((await recordViaApi(held, { note: 'x'.repeat(501) })).status).toBe(400)
    expect(await sql('SELECT id FROM "Payment" WHERE "invoiceId" = $1', [held.invoiceId])).toHaveLength(0)

    await test.step('the modal reports a lapsed hold and stays open', async () => {
      await openBoard(owner.page, owner.kosId)
      const dialog = await openPayModal(owner.page, room.roomNumber)
      await dialog.getByLabel(/Ketik jumlah yang diterima/).fill(String(FIRST_INVOICE))
      await expireHold(held.tenancyId)
      await dialog.getByRole('button', { name: 'Catat Lunas' }).click()
      await expect(toast(owner.page, 'Masa tahan kamar sudah berakhir.')).toBeVisible()
      await expect(dialog).toBeVisible()
      expect(await sql('SELECT id FROM "Payment" WHERE "invoiceId" = $1', [held.invoiceId])).toHaveLength(0)
      expect(await invoiceStatuses(held.tenancyId)).toEqual(['UNPAID'])
    })
    expectHttpErrors(problems, 409)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('scenario 23: the billing reminder opens a WhatsApp message with the invoice, and changes nothing', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'remind' })
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(owner.page, problems)
  try {
    // Month 1 paid by hand; month 2 then exists and is pushed 45 days into the past so it is overdue.
    expect((await recordViaApi(held)).status).toBe(200)
    await shiftDueDates(held.tenancyId, 45)
    const [next] = await sql<{ id: string; amount: number }>(`SELECT id, amount FROM "Invoice" WHERE "tenancyId" = $1 AND status = 'UNPAID' ORDER BY "dueDate" LIMIT 1`, [held.tenancyId])

    await openBoard(owner.page, owner.kosId)
    const row = boardRow(owner.page, room.roomNumber)
    await expect(row.getByText('Menunggak', { exact: true })).toBeVisible()
    await expect(row).toContainText(/Telat \d+ hari/)
    await row.getByRole('button', { name: `Kirim tagihan WhatsApp Kamar ${room.roomNumber}` }).click()

    const dialog = owner.page.getByRole('dialog')
    await expect(dialog).toContainText('Pengingat WhatsApp Santun')
    await expect(dialog).toContainText(`(Kamar ${room.roomNumber})`)
    const link = dialog.getByRole('link', { name: /Buka WhatsApp/ })
    const href = (await link.getAttribute('href'))!
    expect(href.startsWith('https://wa.me/')).toBe(true)
    const text = decodeURIComponent(href.split('?text=')[1])
    expect(text).toContain(`Nomor ${room.roomNumber}`)
    expect(Number(text.match(/Rp\s*([\d.]+)/)![1].replace(/\./g, ''))).toBe(next.amount)
    expect(text).toMatch(/terlambat \d+ hari/)
    await expect(link).toHaveAttribute('target', '_blank')

    await test.step('sending a reminder changes no money and no status', async () => {
      // Sorted: the dates were moved, so due-date order no longer matches month order.
      expect((await invoiceStatuses(held.tenancyId)).sort()).toEqual(['PAID', 'UNPAID', 'UNPAID'])
      expect(await sql('SELECT id FROM "Payment" WHERE "invoiceId" = $1', [next.id])).toHaveLength(0)
    })
    expectHttpErrors(problems)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('scenario 23: another owner can neither record a payment for this invoice nor reach its kos', async ({ browser }) => {
  const held = await heldRoom(browser, { label: 'victim' })
  const intruder = await newOwnerWorld(browser, { label: 'intruder', rooms: 1 })
  try {
    const body = { invoiceId: held.invoiceId, method: 'CASH', confirmedAmount: FIRST_INVOICE }
    const viaOwnKos = await trpcRaw(intruder.ctx, 'payment.recordManual', { kosId: intruder.kosId, ...body })
    expect([viaOwnKos.status, viaOwnKos.message]).toEqual([404, 'Tagihan tidak ditemukan.'])
    const viaVictimKos = await trpcRaw(intruder.ctx, 'payment.recordManual', { kosId: held.owner.kosId, ...body })
    expect([403, 404]).toContain(viaVictimKos.status)
    const ended = await trpcRaw(intruder.ctx, 'owner.tenancy.end', { kosId: held.owner.kosId, tenancyId: held.tenancyId })
    expect([403, 404]).toContain(ended.status)

    expect(await sql('SELECT id FROM "Payment" WHERE "invoiceId" = $1', [held.invoiceId])).toHaveLength(0)
    expect(await invoiceStatuses(held.tenancyId)).toEqual(['UNPAID'])
    const [tenancy] = await sql<{ status: string }>('SELECT status FROM "Tenancy" WHERE id = $1', [held.tenancyId])
    expect(tenancy.status).toBe('PENDING')
  } finally {
    await Promise.all([held.owner.ctx.close(), held.student.ctx.close(), intruder.ctx.close()])
  }
})
