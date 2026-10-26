import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { heldRoom, newContext, newOwnerWorld, newStudent, sessionCompleted, sql, trpcPost, watch, webhook, expectHttpErrors, type HeldRoom } from './seams'

// The kuitansi page: who may open a receipt, what it shows, how it prints, and the method label per payment provider.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const RECEIPT_NO = /^KB\/\d{4}\/\d{2}\/\d{4}$/
const FIRST_INVOICE = 1_525_000

/** A held room whose first invoice the owner recorded as cash. */
async function paidByCash(browser: Parameters<typeof heldRoom>[0], label: string) {
  const held = await heldRoom(browser, { label })
  const receipt = await trpcPost<{ receiptNumber: number; receiptNo: string }>(held.owner.ctx, 'payment.recordManual', {
    kosId: held.owner.kosId, invoiceId: held.invoiceId, method: 'CASH', confirmedAmount: FIRST_INVOICE,
  })
  return { held, ...receipt }
}

const closeWorld = (held: HeldRoom, ...more: { ctx: { close(): Promise<void> } }[]) => Promise.all([held.owner.ctx.close(), held.student.ctx.close(), ...more.map((m) => m.ctx.close())])

async function expectReceipt(page: Page, number: number, held: HeldRoom, receiptNo: string) {
  await page.goto(`/kuitansi/${number}`)
  await expect(page.getByTestId('kuitansi-no')).toHaveText(RECEIPT_NO)
  await expect(page.getByTestId('kuitansi-no')).toHaveText(receiptNo)
  await expect(page.getByText(held.owner.kosName).first()).toBeVisible()
  await expect(page.getByText('Penguji E2E').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unduh PDF' })).toBeVisible()
}

test('scenario 24: the payer and the kos owner can open the receipt, with a KB/YYYY/MM/NNNN number', async ({ browser, problems }) => {
  const { held, receiptNumber, receiptNo } = await paidByCash(browser, 'rcpt-ok')
  watch(held.student.page, problems)
  watch(held.owner.page, problems)
  try {
    await test.step('payer', () => expectReceipt(held.student.page, receiptNumber, held, receiptNo))
    await test.step('owner', () => expectReceipt(held.owner.page, receiptNumber, held, receiptNo))
    await test.step('the number is year/month of payment plus the receipt sequence', async () => {
      const [{ paidAt }] = await sql<{ paidAt: Date }>('SELECT "paidAt" FROM "Payment" WHERE "receiptNo" = $1', [receiptNumber])
      const wib = new Date(paidAt.getTime() + 7 * 3_600_000).toISOString()
      expect(receiptNo).toBe(`KB/${wib.slice(0, 4)}/${wib.slice(5, 7)}/${String(receiptNumber).padStart(4, '0')}`)
    })
    expectHttpErrors(problems)
  } finally {
    await closeWorld(held)
  }
})

test('scenario 24: everyone else is refused or asked to sign in, and unknown or unpaid numbers read as not found', async ({ browser, problems }) => {
  const { held, receiptNumber } = await paidByCash(browser, 'rcpt-deny')
  const stranger = await newStudent(browser, { label: 'rcpt-stranger' })
  const otherOwner = await newOwnerWorld(browser, { label: 'rcpt-owner2', rooms: 1 })
  const visitor = await newContext(browser)
  // A second world with an attempt that never paid: its number exists but is not a receipt.
  const unpaid = await heldRoom(browser, { label: 'rcpt-unpaid' })
  for (const p of [stranger.page, otherOwner.page, visitor.page, held.student.page]) watch(p, problems)
  try {
    const attempt = await trpcPost<{ paymentId: string }>(unpaid.student.ctx, 'payment.start', { invoiceId: unpaid.invoiceId })
    const [{ receiptNo: attemptNumber }] = await sql<{ receiptNo: number }>('SELECT "receiptNo" FROM "Payment" WHERE id = $1', [attempt.paymentId])

    for (const [who, page] of [['another student', stranger.page], ['another owner', otherOwner.page]] as const) {
      await test.step(`${who} is refused`, async () => {
        await page.goto(`/kuitansi/${receiptNumber}`)
        await expect(page.getByRole('heading', { name: 'Tidak dapat dibuka' })).toBeVisible()
        await expect(page.getByText('Anda tidak memiliki akses ke kuitansi ini.')).toBeVisible()
        await expect(page.getByTestId('kuitansi-no')).toHaveCount(0)
      })
    }

    await test.step('a signed-out visitor is asked to sign in', async () => {
      await visitor.page.goto(`/kuitansi/${receiptNumber}`)
      await expect(visitor.page.getByRole('heading', { name: 'Masuk untuk Melihat Kuitansi' })).toBeVisible()
      await expect(visitor.page.getByText('Kuitansi hanya dapat dibuka oleh penyewa yang membayar dan pemilik kosnya.')).toBeVisible()
      await visitor.page.getByRole('main').getByRole('button', { name: 'Masuk', exact: true }).click()
      await expect(visitor.page.getByRole('dialog')).toBeVisible()
    })

    await test.step('an unknown number and an unpaid attempt read the same as not found', async () => {
      for (const n of [999_999_999, attemptNumber]) {
        await held.student.page.goto(`/kuitansi/${n}`)
        await expect(held.student.page.getByRole('heading', { name: 'Kuitansi tidak ditemukan' })).toBeVisible()
        await expect(held.student.page.getByText('Nomor kuitansi ini tidak ada atau belum dibayar.')).toBeVisible()
      }
      await held.student.page.goto('/kuitansi/abc')
      await expect(held.student.page.getByText('Nomor kuitansi tidak valid.')).toBeVisible()
    })
    expectHttpErrors(problems, 403, 404)
  } finally {
    await closeWorld(held, stranger, otherOwner, visitor, unpaid.owner, unpaid.student)
  }
})

test('scenario 24: printing hides the site chrome and the download button but keeps the receipt', async ({ browser, problems }) => {
  const { held, receiptNumber } = await paidByCash(browser, 'rcpt-print')
  const { page } = held.student
  watch(page, problems)
  try {
    await page.goto(`/kuitansi/${receiptNumber}`)
    const chrome = page.locator('header').first()
    const button = page.getByRole('button', { name: 'Unduh PDF' })
    await expect(chrome).toBeVisible()
    await expect(button).toBeVisible()

    await page.emulateMedia({ media: 'print' })
    await expect(chrome).toBeHidden()
    await expect(button).toBeHidden()
    await expect(page.getByTestId('kuitansi-no')).toBeVisible()
    await expect(page.getByText(held.owner.kosName).first()).toBeVisible()

    await page.emulateMedia({ media: 'screen' })
    await expect(button).toBeVisible()
    expectHttpErrors(problems)
  } finally {
    await closeWorld(held)
  }
})

const METHODS = [
  // The generic MANUAL label never shows for owner-recorded payments: they always carry a method, so the page says "Tunai" or "Transfer bank".
  { provider: 'MANUAL', label: 'Tunai, dicatat oleh pemilik' },
  { provider: 'MOCK', label: 'Pembayaran online KoBo' },
  { provider: 'XENDIT', label: 'Pembayaran online terverifikasi (Xendit)' },
] as const

for (const { provider, label } of METHODS) {
  test(`scenario 24: a ${provider} payment's kuitansi says "${label}"`, async ({ browser, problems }) => {
    const held = await heldRoom(browser, { label: `rcpt-${provider.toLowerCase()}`, demo: provider === 'MOCK' })
    const { page, ctx } = held.student
    watch(page, problems)
    try {
      let receiptNumber: number
      if (provider === 'MANUAL') {
        const r = await trpcPost<{ receiptNumber: number }>(held.owner.ctx, 'payment.recordManual', {
          kosId: held.owner.kosId, invoiceId: held.invoiceId, method: 'CASH', confirmedAmount: FIRST_INVOICE,
        })
        receiptNumber = r.receiptNumber
      } else {
        const started = await trpcPost<{ paymentId: string }>(ctx, 'payment.start', { invoiceId: held.invoiceId })
        if (provider === 'MOCK') await trpcPost(ctx, 'payment.simulate', { paymentId: started.paymentId })
        else expect((await webhook(page.request, sessionCompleted(started.paymentId, FIRST_INVOICE))).json.result).toBe('SETTLED')
        ;[{ receiptNo: receiptNumber }] = await sql<{ receiptNo: number }>('SELECT "receiptNo" FROM "Payment" WHERE id = $1', [started.paymentId])
        const [row] = await sql<{ provider: string; status: string }>('SELECT provider, status FROM "Payment" WHERE id = $1', [started.paymentId])
        expect(row).toEqual({ provider, status: 'PAID' })
      }
      await page.goto(`/kuitansi/${receiptNumber}`)
      await expect(page.getByTestId('kuitansi-no')).toHaveText(RECEIPT_NO)
      await expect(page.getByText(label)).toBeVisible()
      expectHttpErrors(problems)
    } finally {
      await closeWorld(held)
    }
  })
}
