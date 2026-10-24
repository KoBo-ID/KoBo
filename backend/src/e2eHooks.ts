import type { Hono } from 'hono'
import { z } from 'zod'
import type { PrismaClient } from './db/client.ts'
import { drainOutbox, transportFromEnv } from './outbox.ts'
import { MockPaymentProvider } from './payment/mock.ts'
import type { CheckoutSession, CreateCheckoutInput, CreateRefundInput, GetSessionInput, PaymentProvider, PaymentSessionSnapshot, RefundSnapshot } from './payment/provider.ts'
import { drainPaymentRefunds } from './payment/refunds.ts'
import { sweepStalePayments } from './payment/reconcile.ts'
import { PaymentService } from './payment/service.ts'
import { XenditError } from './payment/xendit.ts'
import { advanceAllWaitlists } from './waitlist.ts'

/*
 * Test/e2e only. Everything here is wired solely when env.ts e2eHooksEnabled() allows it (ALLOW_E2E_HOOKS=1 plus
 * PAYMENT_PROVIDER=mock, a loopback database and, in production mode, ALLOW_MOCK_PAYMENTS=1). Real users then go through the full
 * XENDIT pipeline (attempts, webhook, reconcile, refunds) against FakeXenditProvider instead of the network; demo users stay MOCK.
 */

export const E2E_CALLBACK_TOKEN = 'e2e-callback-token'
export const E2E_BUSINESS_ID = 'kobo-e2e-business'

export type FakeSessionState = 'ACTIVE' | 'COMPLETED' | 'EXPIRED'
export type FakeRefundMode = 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'ERROR'

const REQUEST_PREFIX = 'pr_e2e_'

/** Network-free stand-in for Xendit. Ids embed the KoBo Payment.id so a test can build matching webhook bodies. */
export class FakeXenditProvider implements PaymentProvider {
  readonly kind = 'XENDIT' as const
  // Explicit field, not a parameter property: Node's strip-only TypeScript mode rejects those.
  private readonly prisma: Pick<PrismaClient, 'payment'>
  /** What getSession reports per payment (default ACTIVE). Set by POST /api/__e2e/xendit/session. */
  readonly sessions = new Map<string, FakeSessionState>()
  /** How createRefund answers per payment (default SUCCEEDED). Set by POST /api/__e2e/xendit/refund. */
  readonly refundModes = new Map<string, FakeRefundMode>()
  /** Invoices whose next createCheckout fails once with a provider outage. Set by POST /api/__e2e/xendit/outage. */
  readonly failCheckout = new Set<string>()

  constructor(prisma: Pick<PrismaClient, 'payment'>) {
    this.prisma = prisma
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const payment = await this.prisma.payment.findUnique({ where: { id: input.paymentId }, select: { invoiceId: true } })
    if (payment && this.failCheckout.delete(payment.invoiceId)) {
      throw new XenditError('CREATE_SESSION', 503, 'SERVER_ERROR', true, false, 'e2e outage')
    }
    const id = input.paymentId
    return {
      providerSessionId: `ps_e2e_${id}`,
      providerPaymentRequestId: null,
      providerBusinessId: E2E_BUSINESS_ID,
      // A real Xendit host so the frontend's checkout allow-list accepts it; specs stub the host and follow the return links.
      checkoutUrl: `https://checkout-staging.xendit.co/e2e/${id}?success=${encodeURIComponent(input.successReturnUrl)}&failure=${encodeURIComponent(input.failureReturnUrl)}`,
      expiresAt: input.expiresAt,
    }
  }

  async getSession(input: GetSessionInput): Promise<PaymentSessionSnapshot> {
    const id = input.providerSessionId.replace('ps_e2e_', '')
    const state = this.sessions.get(id) ?? 'ACTIVE'
    const payment = state === 'ACTIVE' ? null : await this.prisma.payment.findUnique({ where: { id }, select: { amount: true } })
    return {
      state,
      referenceId: id,
      providerSessionId: input.providerSessionId,
      providerPaymentRequestId: `${REQUEST_PREFIX}${id}`,
      providerPaymentId: `py_e2e_${id}`,
      providerBusinessId: E2E_BUSINESS_ID,
      amount: payment?.amount ?? null,
      currency: 'IDR',
      updatedAt: new Date(),
    }
  }

  async createRefund(input: CreateRefundInput): Promise<RefundSnapshot> {
    const id = input.providerPaymentRequestId.replace(REQUEST_PREFIX, '')
    const mode = this.refundModes.get(id) ?? 'SUCCEEDED'
    if (mode === 'ERROR') throw new XenditError('CREATE_REFUND', 400, 'REFUND_NOT_SUPPORTED', false, false, 'e2e refund refused')
    return { providerRefundId: `rf_e2e_${input.referenceId}`, state: mode, updatedAt: new Date() }
  }
}

export interface E2eHooks {
  provider: FakeXenditProvider
  paymentService: PaymentService
}

export function createE2eHooks(prisma: PrismaClient): E2eHooks {
  const provider = new FakeXenditProvider(prisma)
  const paymentService = new PaymentService({
    defaultProvider: provider,
    mockProvider: new MockPaymentProvider(),
    xenditWebhook: { callbackToken: E2E_CALLBACK_TOKEN, businessId: E2E_BUSINESS_ID },
  })
  return { provider, paymentService }
}

const tickBody = z.object({ worker: z.enum(['sweep', 'refunds', 'waitlist', 'outbox']), now: z.iso.datetime().optional() })
const sessionBody = z.object({ paymentId: z.string().min(1), state: z.enum(['ACTIVE', 'COMPLETED', 'EXPIRED']) })
const refundBody = z.object({ paymentId: z.string().min(1), mode: z.enum(['SUCCEEDED', 'PENDING', 'FAILED', 'ERROR']) })
const outageBody = z.object({ invoiceId: z.string().min(1) })

/**
 * Mounted by createApp before the /api/* 404, only when hooks exist. No authentication: the env guard is the protection.
 * Each route takes JSON and answers { ok: true, ... } or 400 { ok: false, error }.
 */
export function mountE2eHooks(app: Hono, prisma: PrismaClient, hooks: E2eHooks): void {
  const route = <T extends z.ZodType>(path: string, schema: T, run: (body: z.infer<T>) => Promise<unknown> | unknown) =>
    app.post(path, async (c) => {
      const parsed = schema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return c.json({ ok: false, error: 'Body tidak valid.' }, 400)
      return c.json({ ok: true, result: (await run(parsed.data)) ?? null })
    })

  // Runs one background worker once, on demand. Global: it also touches other specs' rows, so assert only your own ids.
  route('/api/__e2e/tick', tickBody, ({ worker, now }) => {
    const at = now ? new Date(now) : new Date()
    if (worker === 'sweep') return sweepStalePayments(prisma, hooks.paymentService, { limit: 500, now: at })
    if (worker === 'refunds') return drainPaymentRefunds(prisma, hooks.paymentService, { batchSize: 100, now: () => at })
    if (worker === 'waitlist') return advanceAllWaitlists(prisma, at)
    return drainOutbox(prisma, transportFromEnv(), { batchSize: 200 })
  })

  route('/api/__e2e/xendit/session', sessionBody, ({ paymentId, state }) => {
    hooks.provider.sessions.set(paymentId, state)
  })
  route('/api/__e2e/xendit/refund', refundBody, ({ paymentId, mode }) => {
    hooks.provider.refundModes.set(paymentId, mode)
  })
  route('/api/__e2e/xendit/outage', outageBody, ({ invoiceId }) => {
    hooks.provider.failCheckout.add(invoiceId)
  })
}
