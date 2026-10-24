import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { expectHttpErrors, expireAttempt, heldRoom, latestPayment, sql, staleCreating, trpcPost, watch } from './seams'

// The demo-like student (isDemo, MOCK provider) pays through the labelled "Simulasikan Pembayaran" button.
// Every test builds its own owner, student and room, so nothing here touches the shared demo accounts.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const RECEIPT = /^KB\/\d{4}\/\d{2}\/\d{4}$/
const bulan1 = (page: Page) => page.getByRole('row').filter({ hasText: 'Bulan 1' })
const hint = (page: Page) => bulan1(page).getByRole('status')
const attempts = (invoiceId: string) => sql<{ id: string; status: string; provider: string }>('SELECT id, status, provider FROM "Payment" WHERE "invoiceId" = $1 ORDER BY "createdAt"', [invoiceId])
const closeAll = (...ctxs: BrowserContext[]) => Promise.all(ctxs.map((c) => c.close()))

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'page scrolls sideways').toBe(true)
}

test('scenario 10: a demo student simulates payment and the rental turns active with a receipt, on both sides', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'mock-pay', demo: true })
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(owner.page, problems)
  try {
    await student.page.goto('/my-kos')
    const row = bulan1(student.page)

    await test.step('before paying: Belum dibayar, a deadline and a pay button, no simulator yet', async () => {
      await expect(student.page.getByTestId('tenancy-card')).toHaveAttribute('data-status', 'PENDING')
      await expect(row).toContainText('Belum dibayar')
      await expect(student.page.getByText(/Kamar ditahan sampai/)).toBeVisible()
      await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toHaveCount(0)
    })

    await test.step('Bayar Sekarang opens a labelled simulator instead of a redirect', async () => {
      await row.getByRole('button', { name: 'Bayar Sekarang' }).click()
      await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
      await expect(student.page).toHaveURL(/\/my-kos$/)
      expect(await latestPayment(held.invoiceId)).toMatchObject({ provider: 'MOCK', status: 'PENDING' })
      await expect(row).not.toContainText('Lunas')
    })

    await test.step('simulating settles: Lunas, active rental, receipt link, no pay button', async () => {
      await row.getByRole('button', { name: 'Simulasikan Pembayaran' }).click()
      await expect(row).toContainText('Lunas')
      await expect(row.getByRole('button', { name: 'Bayar Sekarang' })).toHaveCount(0)
      await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toHaveCount(0)
      await expect(row.getByRole('link', { name: RECEIPT })).toBeVisible()
      const card = student.page.getByTestId('tenancy-card')
      await expect(card).toHaveAttribute('data-status', 'ACTIVE')
      await expect(card.getByText('Sewa Aktif')).toBeVisible()
      await expect(card.getByText('Pembayaran tercatat di KoBo')).toBeVisible()
      await expect(card.getByRole('link', { name: 'Lihat Kuitansi Resmi' })).toBeVisible()
      const [inv] = await sql<{ status: string }>('SELECT status FROM "Invoice" WHERE id = $1', [held.invoiceId])
      expect(inv.status).toBe('PAID')
    })

    await test.step('the owner board shows Lunas; a MOCK payment carries no verification label', async () => {
      await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}`)
      const boardRow = owner.page.getByRole('row').filter({ hasText: `Kamar ${room.roomNumber}` })
      await expect(boardRow.getByText('Lunas', { exact: true })).toBeVisible()
      // boardPayment() returns null for a MOCK receipt: "Pembayaran terverifikasi" is only for Xendit money.
      await expect(boardRow.getByTestId('payment-label')).toHaveCount(0)
      await expect(boardRow.getByRole('link', { name: `Lihat kuitansi Kamar ${room.roomNumber}` })).toBeVisible()
    })

    await test.step('the receipt mails for student and owner are queued', async () => {
      await expect
        .poll(async () => (await sql('SELECT id FROM "EmailOutbox" WHERE "to" = $1 AND template = $2', [student.email, 'payment-received'])).length)
        .toBe(1)
      await expect
        .poll(async () => (await sql('SELECT id FROM "EmailOutbox" WHERE "to" = $1 AND template = $2', [owner.email, 'payment-received-owner'])).length)
        .toBe(1)
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 12: an expired attempt explains itself and Bayar Sekarang opens a fresh one', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'mock-exp', demo: true })
  const { owner, student } = held
  watch(student.page, problems)
  try {
    await student.page.goto('/my-kos')
    const row = bulan1(student.page)
    await row.getByRole('button', { name: 'Bayar Sekarang' }).click()
    await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
    const first = await latestPayment(held.invoiceId)

    await test.step('the session lapses: hint, pay button, no simulator', async () => {
      await expireAttempt(first.id)
      await student.page.reload()
      await expect(hint(student.page)).toHaveText('Sesi pembayaran sebelumnya berakhir. Silakan mulai pembayaran baru.')
      await expect(row.getByRole('button', { name: 'Bayar Sekarang' })).toBeVisible()
      await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toHaveCount(0)
      await expect(row).toContainText('Belum dibayar')
    })

    await test.step('paying again makes a new attempt, and the old one stays EXPIRED', async () => {
      await row.getByRole('button', { name: 'Bayar Sekarang' }).click()
      await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
      await expect(row).not.toContainText('Sesi pembayaran sebelumnya berakhir')
      const rows = await attempts(held.invoiceId)
      expect(rows.map((r) => r.status)).toEqual(['EXPIRED', 'PENDING'])
      expect(rows[1].id).not.toBe(first.id)
    })

    await test.step('the fresh attempt settles the invoice', async () => {
      await row.getByRole('button', { name: 'Simulasikan Pembayaran' }).click()
      await expect(row).toContainText('Lunas')
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 13: a CREATING attempt whose session lapsed is failed and replaced when the student pays again', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'mock-stale', demo: true })
  const { owner, student } = held
  watch(student.page, problems)
  try {
    await student.page.goto('/my-kos')
    const row = bulan1(student.page)
    await row.getByRole('button', { name: 'Bayar Sekarang' }).click()
    await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
    const stuck = await latestPayment(held.invoiceId)
    await staleCreating(stuck.id)
    await sql(`UPDATE "Payment" SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`, [stuck.id])

    await test.step('with no live session the student is offered a fresh payment', async () => {
      await student.page.reload()
      await expect(row).toContainText('Belum dibayar')
      await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toHaveCount(0)
      await expect(row.getByRole('button', { name: 'Bayar Sekarang' })).toBeVisible()
    })

    await test.step('paying again fails the stale row and opens a new PENDING one', async () => {
      await row.getByRole('button', { name: 'Bayar Sekarang' }).click()
      await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
      const rows = await attempts(held.invoiceId)
      expect(rows.map((r) => r.status)).toEqual(['FAILED', 'PENDING'])
      const [{ failureCode }] = await sql<{ failureCode: string }>('SELECT "failureCode" FROM "Payment" WHERE id = $1', [stuck.id])
      expect(failureCode).toBe('STALE_CREATING')
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 13: a stale CREATING row that still has session time leaves only a Periksa Status that cannot help', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'mock-stuck', demo: true })
  const { owner, student } = held
  watch(student.page, problems)
  try {
    await student.page.goto('/my-kos')
    const row = bulan1(student.page)
    await row.getByRole('button', { name: 'Bayar Sekarang' }).click()
    await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
    const stuck = await latestPayment(held.invoiceId)
    await staleCreating(stuck.id) // expiresAt is still ~30 minutes away, so the row counts as a live attempt

    await test.step('finding: no pay button and no simulator, only Periksa Status, which asks the provider nothing for MOCK', async () => {
      await student.page.reload()
      await expect(row.getByRole('button', { name: 'Periksa Status' })).toBeVisible()
      await expect(row.getByRole('button', { name: 'Bayar Sekarang' })).toHaveCount(0)
      await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toHaveCount(0)
      await row.getByRole('button', { name: 'Periksa Status' }).click()
      await expect(row.getByRole('button', { name: /Periksa Status \(\d+ dtk\)/ })).toBeVisible()
      expect((await attempts(held.invoiceId)).map((r) => r.status)).toEqual(['CREATING'])
    })

    await test.step('the server itself recovers when payment.start runs: FAILED plus a new PENDING', async () => {
      await trpcPost(student.ctx, 'payment.start', { invoiceId: held.invoiceId })
      expect((await attempts(held.invoiceId)).map((r) => r.status)).toEqual(['FAILED', 'PENDING'])
      await student.page.reload()
      await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 14: two tabs — paying in one leaves the other stale, and its simulate fails with a clear message', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'mock-tabs', demo: true })
  const { owner, student } = held
  const tabA = student.page
  const tabB = await student.ctx.newPage()
  watch(tabA, problems)
  watch(tabB, problems)
  try {
    await tabA.goto('/my-kos')
    await bulan1(tabA).getByRole('button', { name: 'Bayar Sekarang' }).click()
    await expect(bulan1(tabA).getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
    await tabB.goto('/my-kos')
    await expect(bulan1(tabB).getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()

    await test.step('tab A pays', async () => {
      await bulan1(tabA).getByRole('button', { name: 'Simulasikan Pembayaran' }).click()
      await expect(bulan1(tabA)).toContainText('Lunas')
    })

    await test.step('tab B still shows the simulator; using it is refused in words, not silence', async () => {
      await expect(bulan1(tabB)).toContainText('Belum dibayar')
      await bulan1(tabB).getByRole('button', { name: 'Simulasikan Pembayaran' }).click()
      await expect(bulan1(tabB).getByRole('alert')).toHaveText('Pembayaran tidak ditemukan atau sudah diproses.')
      expect((await attempts(held.invoiceId)).filter((p) => p.status === 'PAID')).toHaveLength(1)
      expectHttpErrors(problems, 404)
    })

    await test.step('a reload of the stale tab shows the server state', async () => {
      await tabB.reload()
      await expect(bulan1(tabB)).toContainText('Lunas')
      await expect(bulan1(tabB).getByRole('button', { name: 'Simulasikan Pembayaran' })).toHaveCount(0)
    })

    await test.step('back and forward keep the server state', async () => {
      await tabA.goto('/')
      await tabA.goBack()
      await expect(bulan1(tabA)).toContainText('Lunas')
      await tabA.goForward()
      await tabA.goBack()
      await expect(bulan1(tabA)).toContainText('Lunas')
      await expect(bulan1(tabA).getByRole('button', { name: 'Bayar Sekarang' })).toHaveCount(0)
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 14: reload mid-payment keeps the live attempt instead of opening a second one', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'mock-reload', demo: true })
  const { owner, student } = held
  watch(student.page, problems)
  try {
    await student.page.goto('/my-kos')
    const row = bulan1(student.page)
    await row.getByRole('button', { name: 'Bayar Sekarang' }).click()
    await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
    await student.page.reload()
    await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
    expect(await attempts(held.invoiceId)).toHaveLength(1)
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 28: the pay flow does not scroll sideways at 390x844', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'mock-phone', demo: true })
  const { owner, student } = held
  watch(student.page, problems)
  try {
    await student.page.setViewportSize({ width: 390, height: 844 })
    await student.page.goto('/my-kos')
    const row = bulan1(student.page)
    await expect(row).toContainText('Belum dibayar')
    await noHorizontalOverflow(student.page)

    await row.getByRole('button', { name: 'Bayar Sekarang' }).click()
    await expect(row.getByRole('button', { name: 'Simulasikan Pembayaran' })).toBeVisible()
    await noHorizontalOverflow(student.page)

    await expireAttempt((await latestPayment(held.invoiceId)).id)
    await student.page.reload()
    await expect(hint(student.page)).toContainText('Sesi pembayaran sebelumnya berakhir')
    await noHorizontalOverflow(student.page)

    await row.getByRole('button', { name: 'Bayar Sekarang' }).click()
    await row.getByRole('button', { name: 'Simulasikan Pembayaran' }).click()
    await expect(row).toContainText('Lunas')
    await noHorizontalOverflow(student.page)

    await student.page.getByRole('link', { name: 'Lihat Kuitansi Resmi' }).click()
    await expect(student.page.getByTestId('kuitansi-no')).toBeVisible()
    await noHorizontalOverflow(student.page)
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})
