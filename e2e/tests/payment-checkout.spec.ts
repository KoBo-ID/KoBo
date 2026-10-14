import type { Page, Route } from '@playwright/test'
import { test, expect, loginAs } from './fixtures'

// The e2e server runs the mock provider, so the hosted Xendit redirect cannot happen for real. These tests stub the
// tRPC responses the checkout UI depends on and prove the UI's own rules: safe redirects, waiting, and never trusting
// the `?result=success` return flag.

const trpc = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { data } }) })
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()

const payment = (over: Record<string, unknown> = {}) => ({
  id: 'pay-1',
  provider: 'XENDIT',
  status: 'PENDING',
  checkoutUrl: null,
  expiresAt: iso(20 * 60_000),
  paidAt: null,
  receiptNumber: null,
  receiptNo: null,
  ...over,
})

const tenancy = (invoice: Record<string, unknown>) => [
  {
    id: 't-1',
    status: 'PENDING',
    derivedStatus: 'booking',
    startDate: '2026-11-01',
    durationMonths: 3,
    expiresAt: iso(6 * 3600_000),
    kos: { id: 'kos-1', name: 'Kos Uji Bayar', address: 'Jl. Uji', image: null, ownerName: 'Pemilik', ownerPhone: null },
    room: { id: 'room-1', roomNumber: 'A1', floor: 1, type: 'Standar', priceMonthly: 1_000_000 },
    invoices: [
      {
        id: 'inv-1',
        status: 'UNPAID',
        dueDate: '2026-11-01',
        amount: 1_000_000,
        receiptNo: null,
        receiptNumber: null,
        activePayment: null,
        latestPayment: null,
        canPay: true,
        ...invoice,
      },
    ],
    canReview: false,
    review: null,
  },
]

async function stub(page: Page, handlers: Record<string, (route: Route) => Promise<void> | void>) {
  for (const [proc, handler] of Object.entries(handlers)) await page.route(`**/api/trpc/${proc}*`, handler)
}

test('Bayar Sekarang redirects to a known https checkout host', async ({ page }) => {
  await loginAs(page, 'student')
  await page.route('https://checkout-staging.xendit.co/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Xendit checkout</h1>' }))
  await stub(page, {
    'booking.mine': (r) => r.fulfill(trpc(tenancy({}))),
    'payment.start': (r) => r.fulfill(trpc({ kind: 'REDIRECT', paymentId: 'pay-1', checkoutUrl: 'https://checkout-staging.xendit.co/web/abc', expiresAt: iso(60_000) })),
  })
  await page.goto('/my-kos')
  await page.getByRole('button', { name: 'Bayar Sekarang' }).click()
  await page.waitForURL(/checkout-staging\.xendit\.co/)
})

test('an untrusted checkout URL is refused and the tenant stays on KoBo', async ({ page }) => {
  await loginAs(page, 'student')
  await stub(page, {
    'booking.mine': (r) => r.fulfill(trpc(tenancy({}))),
    'payment.start': (r) => r.fulfill(trpc({ kind: 'REDIRECT', paymentId: 'pay-1', checkoutUrl: 'https://evil.example/pay', expiresAt: iso(60_000) })),
  })
  await page.goto('/my-kos')
  await page.getByRole('button', { name: 'Bayar Sekarang' }).click()
  await expect(page.getByRole('alert')).toContainText('Tautan pembayaran tidak valid')
  await expect(page).toHaveURL(/\/my-kos/)
})

test('returning with result=success only waits, then offers Periksa Status; it never marks the invoice paid', async ({ page }) => {
  await loginAs(page, 'student')
  await page.clock.install()
  await stub(page, {
    'booking.mine': (r) => r.fulfill(trpc(tenancy({ canPay: false, activePayment: payment(), latestPayment: payment() }))),
    'payment.status': (r) => r.fulfill(trpc({ ...payment(), invoiceId: 'inv-1', amount: 1_000_000, tenancyStatus: 'PENDING', refund: null })),
  })
  await page.goto('/my-kos?payment=pay-1&result=success')
  await expect(page.getByText('Menunggu konfirmasi pembayaran')).toBeVisible()
  await expect(page.getByText('Belum dibayar')).toBeVisible()
  await page.clock.fastForward(65_000)
  await expect(page.getByRole('button', { name: /Periksa Status/ })).toBeVisible()
  await expect(page.getByText('Lunas')).toHaveCount(0)
})

test('an expired attempt explains itself and offers a fresh Bayar Sekarang', async ({ page }) => {
  await loginAs(page, 'student')
  await stub(page, {
    'booking.mine': (r) => r.fulfill(trpc(tenancy({ canPay: true, activePayment: null, latestPayment: payment({ status: 'EXPIRED' }) }))),
  })
  await page.goto('/my-kos')
  await expect(page.getByText('Sesi pembayaran sebelumnya berakhir')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bayar Sekarang' })).toBeVisible()
})
