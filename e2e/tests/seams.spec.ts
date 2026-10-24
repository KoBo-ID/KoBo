import { test, expect } from './fixtures'
import { heldRoom, latestPayment, sessionCompleted, sessionExpired, sql, stubXenditCheckout, tick, watch, webhook, type TickWorker } from './seams'

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks, which only the local e2e server mounts')

test('every worker tick answers ok', async ({ request }) => {
  for (const worker of ['sweep', 'refunds', 'waitlist', 'outbox'] satisfies TickWorker[]) {
    await expect(tick(request, worker), worker).resolves.not.toBeUndefined()
  }
  // Bad bodies are refused, not crashed on.
  const bad = await request.post('/api/__e2e/tick', { data: { worker: 'nope' } })
  expect(bad.status()).toBe(400)
})

test('a real student pays through the stubbed hosted checkout and is only Lunas once the webhook arrives', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'seam-pay' })
  const { page, ctx } = held.student
  watch(page, problems)
  await stubXenditCheckout(ctx)
  try {
    await page.goto('/my-kos')
    const row = page.getByRole('row').filter({ hasText: 'Bulan 1' })
    await expect(row).toContainText('Belum dibayar')
    await row.getByRole('button', { name: 'Bayar Sekarang' }).click()

    // Redirected to the (stubbed) hosted checkout, which is a known host.
    await page.waitForURL(/^https:\/\/checkout-staging\.xendit\.co\//)
    const attempt = await latestPayment(held.invoiceId)
    expect(attempt).toMatchObject({ provider: 'XENDIT', status: 'PENDING' })

    // Following its success link must not, by itself, claim payment.
    await page.getByRole('link', { name: 'Bayar (simulasi)' }).click()
    await page.waitForURL(/\/my-kos\?payment=/)
    const back = page.getByRole('row').filter({ hasText: 'Bulan 1' })
    await expect(back.getByRole('status')).toContainText(/Menunggu konfirmasi pembayaran|Pembayaran belum terkonfirmasi/)
    await expect(back).not.toContainText('Lunas')
    expect((await latestPayment(held.invoiceId)).status).toBe('PENDING')

    // The provider tells KoBo about the payment.
    const result = await webhook(page.request, sessionCompleted(attempt.id, attempt.amount))
    expect(result).toEqual({ status: 200, json: { ok: true, result: 'SETTLED' } })
    expect(await latestPayment(held.invoiceId)).toMatchObject({ status: 'PAID' })
    const [inv] = await sql<{ status: string }>('SELECT status FROM "Invoice" WHERE id = $1', [held.invoiceId])
    expect(inv.status).toBe('PAID')
    const [ten] = await sql<{ status: string }>('SELECT status FROM "Tenancy" WHERE id = $1', [held.tenancyId])
    expect(ten.status).toBe('ACTIVE')

    await page.goto('/my-kos')
    await expect(page.getByRole('row').filter({ hasText: 'Bulan 1' })).toContainText('Lunas')
    await expect(page.getByRole('row').filter({ hasText: 'Bulan 1' }).getByRole('button', { name: 'Bayar Sekarang' })).toHaveCount(0)

    // Redelivery is recognised, not applied twice.
    expect((await webhook(page.request, sessionCompleted(attempt.id, attempt.amount))).json.result).toBe('DUPLICATE')
  } finally {
    await held.owner.ctx.close()
    await ctx.close()
  }
})

test('webhooks: a wrong token is refused unrecorded; an unknown reference is audited and ignored', async ({ request }) => {
  const ref = `seam-unknown-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

  const wrong = await webhook(request, sessionExpired(ref), 'wrong-token')
  expect(wrong).toEqual({ status: 401, json: { ok: false, error: 'Token tidak valid.' } })
  const missing = await webhook(request, sessionExpired(ref), null)
  expect(missing.status).toBe(401)
  expect(await sql(`SELECT id FROM "PaymentWebhookEvent" WHERE "externalResourceId" LIKE $1`, [`%${ref}%`])).toHaveLength(0)

  const unknown = await webhook(request, sessionExpired(ref))
  expect(unknown.status).toBe(200)
  expect(unknown.json.result).toBe('UNMATCHED')
  const rows = await sql<{ result: string; paymentId: string | null }>(`SELECT result, "paymentId" FROM "PaymentWebhookEvent" WHERE "externalResourceId" LIKE $1`, [`%${ref}%`])
  expect(rows).toHaveLength(1)
  expect(['UNMATCHED', 'IGNORED']).toContain(rows[0].result)
  expect(rows[0].paymentId).toBeNull()
})
