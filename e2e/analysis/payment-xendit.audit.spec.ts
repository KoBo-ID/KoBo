import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from './safe-fixtures'
import { expectHttpErrors, heldRoom, latestPayment, sessionCompleted, sessionExpired, sql, stubXenditCheckout, watch, webhook, xendit, type HeldRoom } from '../tests/seams'

// A real (non-demo) student pays through the fake Xendit provider. The hosted checkout is stubbed in the browser and only
// webhooks (or Periksa Status, which asks the provider) can settle a payment.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const CHECKOUT = /^https:\/\/checkout-staging\.xendit\.co\//
const RETURN = /\/my-kos\?payment=/
const bulan1 = (page: Page) => page.getByRole('row').filter({ hasText: 'Bulan 1' })
const hint = (page: Page) => bulan1(page).getByRole('status')
const closeAll = (...ctxs: BrowserContext[]) => Promise.all(ctxs.map((c) => c.close()))
const statuses = async (invoiceId: string) => (await sql<{ status: string }>('SELECT status FROM "Payment" WHERE "invoiceId" = $1 ORDER BY "createdAt"', [invoiceId])).map((r) => r.status)

/** Held room for a real student, with the hosted checkout stubbed and the page's console watched. */
async function setup(browser: Parameters<typeof heldRoom>[0], label: string, problems: string[]): Promise<HeldRoom> {
  const held = await heldRoom(browser, { label })
  await stubXenditCheckout(held.student.ctx)
  watch(held.student.page, problems)
  watch(held.owner.page, problems)
  return held
}

/** Bayar Sekarang -> hosted checkout (stub). Returns the attempt. */
async function startPayment(page: Page, invoiceId: string) {
  await page.goto('/my-kos')
  await bulan1(page).getByRole('button', { name: 'Bayar Sekarang' }).click()
  await page.waitForURL(CHECKOUT)
  const attempt = await latestPayment(invoiceId)
  expect(attempt).toMatchObject({ provider: 'XENDIT', status: 'PENDING' })
  return attempt
}

test('scenario 11: the wait ends after a minute, Periksa Status has a cooldown, and a completed session settles', async ({ browser, problems }) => {
  const held = await setup(browser, 'xnd-clock', problems)
  const { owner, student } = held
  const { page } = student
  await student.ctx.clock.install() // fake timers before any page script runs; real time keeps flowing
  try {
    const attempt = await startPayment(page, held.invoiceId)
    await page.getByRole('link', { name: 'Bayar (simulasi)' }).click()
    await page.waitForURL(RETURN)

    await test.step('right after the return: waiting message, no Periksa Status, nothing claimed', async () => {
      await expect(hint(page)).toHaveText('Menunggu konfirmasi pembayaran…')
      await expect(bulan1(page).getByRole('button', { name: 'Periksa Status' })).toHaveCount(0)
      await expect(bulan1(page)).not.toContainText('Lunas')
    })

    await test.step('after 60 seconds the wait stops and offers a manual check', async () => {
      await page.clock.runFor(61_000)
      await expect(hint(page)).toHaveText('Pembayaran belum terkonfirmasi. Periksa status untuk memastikan.')
      await expect(bulan1(page).getByRole('button', { name: 'Periksa Status' })).toBeVisible()
      await expect(bulan1(page).getByRole('button', { name: 'Bayar Sekarang' })).toHaveCount(0)
    })

    await test.step('checking while the provider still says ACTIVE starts a 30 second cooldown and changes nothing', async () => {
      await xendit.session(page, attempt.id, 'ACTIVE')
      await bulan1(page).getByRole('button', { name: 'Periksa Status' }).click()
      const cooling = bulan1(page).getByRole('button', { name: /^Periksa Status \(\d+ dtk\)$/ })
      await expect(cooling).toBeVisible()
      await expect(cooling).toBeDisabled()
      expect((await latestPayment(held.invoiceId)).status).toBe('PENDING')
      // The countdown re-arms its 1 s timer after each render, so advance the clock a second at a time.
      await expect.poll(async () => { await page.clock.runFor(1_000); return bulan1(page).getByRole('button', { name: 'Periksa Status', exact: true }).count() }, { timeout: 20_000 }).toBe(1)
      await expect(bulan1(page).getByRole('button', { name: 'Periksa Status', exact: true })).toBeEnabled()
    })

    await test.step('once the provider reports COMPLETED, Periksa Status settles the invoice', async () => {
      // The server throttles lookups per attempt in real time (30 s); reset it so the test does not sleep.
      await sql('UPDATE "Payment" SET "lastReconciledAt" = NULL WHERE id = $1', [attempt.id])
      await xendit.session(page, attempt.id, 'COMPLETED')
      await bulan1(page).getByRole('button', { name: 'Periksa Status', exact: true }).click()
      await expect(bulan1(page)).toContainText('Lunas')
      await expect(bulan1(page).getByRole('button', { name: /Periksa Status/ })).toHaveCount(0)
      expect((await latestPayment(held.invoiceId)).status).toBe('PAID')
      await expect(student.page.getByTestId('tenancy-card')).toHaveAttribute('data-status', 'ACTIVE')
    })

    await test.step('the owner board now says the money is verified', async () => {
      await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}`)
      const row = owner.page.getByRole('row').filter({ hasText: `Kamar ${owner.rooms[0].roomNumber}` })
      await expect(row.getByText('Lunas', { exact: true })).toBeVisible()
      await expect(row.getByTestId('payment-label')).toHaveText('Pembayaran terverifikasi')
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 15: a cancelled or unknown return never claims payment', async ({ browser, problems }) => {
  const held = await setup(browser, 'xnd-return', problems)
  const { owner, student } = held
  const { page } = student
  try {
    const attempt = await startPayment(page, held.invoiceId)

    await test.step('Batalkan returns with result=cancel: still waiting for the provider, not paid, attempt untouched', async () => {
      await page.getByRole('link', { name: 'Batalkan' }).click()
      await page.waitForURL(/result=cancel/)
      await expect(bulan1(page)).toContainText('Belum dibayar')
      await expect(bulan1(page)).not.toContainText('Lunas')
      expect((await latestPayment(held.invoiceId)).status).toBe('PENDING')
    })

    await test.step('a return link for a payment that is not the account\'s says so and cleans the URL', async () => {
      await page.goto('/my-kos?payment=bukan-milik-saya&result=success')
      await expect(page.getByText('Pembayaran tidak ditemukan di akun Anda.')).toBeVisible()
      await expect(page).toHaveURL(/\/my-kos$/)
      await expect(bulan1(page)).toContainText('Belum dibayar')
    })

    await test.step('another user\'s attempt id is not readable either', async () => {
      const res = await owner.page.request.get(`/api/trpc/payment.status?input=${encodeURIComponent(JSON.stringify({ paymentId: attempt.id }))}`)
      expect(res.status()).toBe(404)
    })
    expectHttpErrors(problems, 404)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 16: Lanjutkan Pembayaran resumes the same hosted session instead of opening a new one', async ({ browser, problems }) => {
  const held = await setup(browser, 'xnd-resume', problems)
  const { owner, student } = held
  const { page } = student
  try {
    const attempt = await startPayment(page, held.invoiceId)
    const sessionUrl = page.url()
    const [{ checkoutUrl }] = await sql<{ checkoutUrl: string }>('SELECT "checkoutUrl" FROM "Payment" WHERE id = $1', [attempt.id])
    expect(sessionUrl).toBe(checkoutUrl)

    await page.goto('/my-kos')
    await expect(bulan1(page).getByRole('button', { name: 'Bayar Sekarang' })).toHaveCount(0)
    await bulan1(page).getByRole('button', { name: 'Lanjutkan Pembayaran' }).click()
    await page.waitForURL(CHECKOUT)
    expect(page.url()).toBe(sessionUrl)
    expect(await statuses(held.invoiceId)).toEqual(['PENDING'])
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 16: an expired webhook closes the attempt and the student can start a fresh one', async ({ browser, problems }) => {
  const held = await setup(browser, 'xnd-expired', problems)
  const { owner, student } = held
  const { page } = student
  try {
    const first = await startPayment(page, held.invoiceId)
    const res = await webhook(page.request, sessionExpired(first.id))
    expect(res).toMatchObject({ status: 200, json: { ok: true } })
    expect(await statuses(held.invoiceId)).toEqual(['EXPIRED'])

    await page.goto('/my-kos')
    await expect(hint(page)).toHaveText('Sesi pembayaran sebelumnya berakhir. Silakan mulai pembayaran baru.')
    await expect(bulan1(page).getByRole('button', { name: 'Lanjutkan Pembayaran' })).toHaveCount(0)
    await bulan1(page).getByRole('button', { name: 'Bayar Sekarang' }).click()
    await page.waitForURL(CHECKOUT)
    expect(await statuses(held.invoiceId)).toEqual(['EXPIRED', 'PENDING'])
    expect(page.url()).not.toBe((await sql<{ checkoutUrl: string }>('SELECT "checkoutUrl" FROM "Payment" WHERE id = $1', [first.id]))[0].checkoutUrl)
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 16: the webhook can arrive before the student returns', async ({ browser, problems }) => {
  const held = await setup(browser, 'xnd-early', problems)
  const { owner, student } = held
  const { page } = student
  try {
    const attempt = await startPayment(page, held.invoiceId)
    expect((await webhook(page.request, sessionCompleted(attempt.id, attempt.amount))).json.result).toBe('SETTLED')

    await page.getByRole('link', { name: 'Bayar (simulasi)' }).click()
    await page.waitForURL(RETURN)
    await expect(page.getByText('Pembayaran sudah tercatat. Kuitansi tersedia di kartu kamar.')).toBeVisible()
    await expect(page).toHaveURL(/\/my-kos$/)
    await expect(bulan1(page)).toContainText('Lunas')
    await expect(bulan1(page).getByRole('button', { name: /Bayar Sekarang|Lanjutkan Pembayaran|Periksa Status/ })).toHaveCount(0)
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 16: duplicate and out-of-order callbacks never undo a payment', async ({ browser, problems }) => {
  const held = await setup(browser, 'xnd-order', problems)
  const { owner, student } = held
  const { page } = student
  try {
    const attempt = await startPayment(page, held.invoiceId)

    await test.step('completed settles, a redelivery is recognised', async () => {
      expect((await webhook(page.request, sessionCompleted(attempt.id, attempt.amount))).json.result).toBe('SETTLED')
      expect((await webhook(page.request, sessionCompleted(attempt.id, attempt.amount))).json.result).toBe('DUPLICATE')
    })

    await test.step('an expired event arriving after completed leaves the payment PAID', async () => {
      const late = await webhook(page.request, sessionExpired(attempt.id))
      expect(late.status).toBe(200)
      expect(late.json.result).not.toBe('SETTLED')
      expect(await statuses(held.invoiceId)).toEqual(['PAID'])
      const [inv] = await sql<{ status: string }>('SELECT status FROM "Invoice" WHERE id = $1', [held.invoiceId])
      expect(inv.status).toBe('PAID')
      const receipts = await sql('SELECT id FROM "Payment" WHERE "invoiceId" = $1 AND "receiptNo" IS NOT NULL', [held.invoiceId])
      expect(receipts).toHaveLength(1)
    })

    await test.step('the student sees one Lunas row and no refund notice', async () => {
      await page.goto('/my-kos')
      await expect(bulan1(page)).toContainText('Lunas')
      await expect(bulan1(page)).not.toContainText('dikembalikan')
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 17: when the provider is down the student sees an error and no attempt is left half-open', async ({ browser, problems }) => {
  const held = await setup(browser, 'xnd-outage', problems)
  const { owner, student } = held
  const { page } = student
  try {
    await page.goto('/my-kos')
    await xendit.outage(page, held.invoiceId)
    await bulan1(page).getByRole('button', { name: 'Bayar Sekarang' }).click()

    await test.step('the browser shows the generic error text (BAD_GATEWAY has no own message), and stays on /my-kos', async () => {
      const alert = bulan1(page).getByRole('alert')
      await expect(alert).toBeVisible()
      // Finding G14: the server's retryable 503 reaches the student as the generic "Terjadi kesalahan" text.
      await expect(alert).toHaveText('Terjadi kesalahan. Silakan coba lagi.')
      await expect(page).toHaveURL(/\/my-kos$/)
    })

    await test.step('no PENDING or CREATING row remains, and the pay button is still there', async () => {
      const left = await statuses(held.invoiceId)
      expect(left.filter((s) => s === 'PENDING' || s === 'CREATING')).toEqual([])
      await expect(bulan1(page).getByRole('button', { name: 'Bayar Sekarang' })).toBeEnabled()
      await expect(bulan1(page)).toContainText('Belum dibayar')
    })

    await test.step('trying again works: the outage was one-shot', async () => {
      await bulan1(page).getByRole('button', { name: 'Bayar Sekarang' }).click()
      await page.waitForURL(CHECKOUT)
      expect((await latestPayment(held.invoiceId)).status).toBe('PENDING')
    })
    // the failed start is a 5xx the browser logs as a console error
    problems.splice(0, problems.length, ...problems.filter((p) => !/status of 5\d\d/.test(p)))
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})
