import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { drainPaymentRefunds } from '../../src/payment/refunds.ts'
import { PaymentService } from '../../src/payment/service.ts'
import { XenditPaymentProvider } from '../../src/payment/xendit.ts'
import { approveApplication, callerFor, newStudent, postXenditWebhook, prisma, sessionWebhook, TEST_BUSINESS_ID, TEST_CALLBACK_TOKEN, vacantRoom } from '../helpers.ts'

// The real XenditPaymentProvider (its HTTP client, schemas and header rules) wired into payment.start, reconcile,
// settlement, the refund worker and the callback route. Only the network is faked, with Xendit-shaped responses.

const PREFIX = 'ps-'
let calls: { method: string; path: string; headers: Headers; body: Record<string, unknown> | null }[]
let completed: Set<string>

const iso = (ms = 0) => new Date(Date.now() + ms).toISOString()

function fakeXendit(): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    calls.push({ method, path: url.pathname, headers: new Headers(init?.headers), body })
    if (method === 'POST' && url.pathname === '/sessions') {
      return Response.json({
        payment_session_id: `${PREFIX}${body!.reference_id as string}`,
        reference_id: body!.reference_id,
        status: 'ACTIVE',
        amount: body!.amount,
        currency: 'IDR',
        payment_link_url: `https://checkout-staging.xendit.co/web/${body!.reference_id as string}`,
        payment_request_id: null,
        business_id: TEST_BUSINESS_ID,
        expires_at: body!.expires_at,
      }, { status: 201 })
    }
    if (method === 'GET' && url.pathname.startsWith('/sessions/')) {
      const sessionId = decodeURIComponent(url.pathname.split('/').pop()!)
      const referenceId = sessionId.slice(PREFIX.length)
      const done = completed.has(referenceId)
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: referenceId } })
      return Response.json({
        payment_session_id: sessionId,
        reference_id: referenceId,
        status: done ? 'COMPLETED' : 'ACTIVE',
        payment_request_id: done ? `pr-${referenceId}` : null,
        payment_id: done ? `py-${referenceId}` : null,
        business_id: TEST_BUSINESS_ID,
        amount: payment.amount,
        currency: 'IDR',
        updated: iso(),
      })
    }
    if (method === 'POST' && url.pathname === '/refunds') {
      return Response.json({ id: `rfd-${body!.reference_id as string}`, reference_id: body!.reference_id, payment_request_id: body!.payment_request_id, currency: 'IDR', amount: body!.amount, status: 'PENDING', updated: iso() }, { status: 201 })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
}

function service() {
  const provider = new XenditPaymentProvider({ secretApiKey: 'xnd_development_test', businessId: TEST_BUSINESS_ID, apiBaseUrl: 'https://api.xendit.test', fetch: fakeXendit() })
  return new PaymentService({ defaultProvider: provider, xenditWebhook: { callbackToken: TEST_CALLBACK_TOKEN, businessId: TEST_BUSINESS_ID } })
}

beforeEach(async () => {
  calls = []
  completed = new Set()
  vi.stubEnv('PAYMENT_RETURN_ORIGIN', 'https://kobo.test')
  await resetDb(prisma)
})
afterEach(() => vi.unstubAllEnvs())

async function started() {
  const student = await newStudent()
  const room = await vacantRoom()
  const approved = await approveApplication(student.id, room.id)
  const svc = service()
  const out = await callerFor(student.id, { paymentService: svc }).payment.start({ invoiceId: approved.invoiceId })
  if (out.kind !== 'REDIRECT') throw new Error(`expected REDIRECT, got ${out.kind}`)
  return { student, svc, ...approved, paymentId: out.paymentId, out }
}

describe('Xendit client wired through the payment flow', () => {
  it('starts a session with Basic auth, no for-user-id for the master business, and https return URLs', async () => {
    const { paymentId, out } = await started()
    expect(out.checkoutUrl).toBe(`https://checkout-staging.xendit.co/web/${paymentId}`)
    const create = calls.find((c) => c.path === '/sessions')!
    expect(create.headers.get('authorization')).toMatch(/^Basic /)
    expect(create.headers.has('for-user-id')).toBe(false)
    expect(create.body).toMatchObject({ reference_id: paymentId, currency: 'IDR', country: 'ID' })
    expect(JSON.stringify(create.body)).toContain('https://kobo.test/my-kos?payment=')
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: 'PENDING', providerSessionId: `${PREFIX}${paymentId}`, providerBusinessId: TEST_BUSINESS_ID })
  })

  it('settles through the callback route after the real client created the session', async () => {
    const { paymentId, tenancyId } = await started()
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
    expect((await postXenditWebhook(sessionWebhook('completed', payment))).status).toBe(200)
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ACTIVE')
  })

  it('reconcile asks the real client for the session and settles when Xendit says COMPLETED', async () => {
    const { student, svc, paymentId, tenancyId } = await started()
    completed.add(paymentId)
    const out = await callerFor(student.id, { paymentService: svc }).payment.reconcile({ paymentId })
    expect(out.status).toBe('PAID')
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ACTIVE')
    const get = calls.find((c) => c.method === 'GET')!
    expect(get.headers.has('for-user-id')).toBe(false)
  })

  it('a late payment is refunded through the real client with a stable idempotency key, then closed by the refund callback', async () => {
    const { svc, paymentId, tenancyId } = await started()
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
    // Completed AFTER the hold ended, so it must be refunded (a payment completed before it would be honoured).
    await postXenditWebhook(sessionWebhook('completed', payment, { updated: iso() }))
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('REFUND_PENDING')

    expect(await drainPaymentRefunds(prisma, svc)).toMatchObject({ submitted: 1 })
    const refundCall = calls.find((c) => c.path === '/refunds')!
    expect(refundCall.headers.get('idempotency-key')).toBe(`refund_${paymentId}`)
    expect(refundCall.headers.has('for-user-id')).toBe(false)
    expect(refundCall.body).toMatchObject({ reference_id: `refund_${paymentId}`, payment_request_id: `pr_${paymentId}`, amount: payment.amount, currency: 'IDR', reason: 'CANCELLATION' })

    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
    const callback = {
      event: 'refund.succeeded',
      business_id: TEST_BUSINESS_ID,
      created: iso(),
      data: { id: `rfd-refund_${paymentId}`, reference_id: `refund_${paymentId}`, payment_request_id: paid.providerPaymentRequestId, amount: paid.amount, currency: 'IDR', status: 'SUCCEEDED', failure_code: null, updated: iso() },
    }
    expect((await postXenditWebhook(callback)).status).toBe(200)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('REFUNDED')
  })
})
