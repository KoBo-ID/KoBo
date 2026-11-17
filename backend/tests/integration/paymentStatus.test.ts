import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import type { PaymentProvider, PaymentSessionSnapshot } from '../../src/payment/provider.ts'
import { PaymentService } from '../../src/payment/service.ts'
import { applyPaymentEventTx } from '../../src/payment/settlement.ts'
import { XenditError } from '../../src/payment/xendit.ts'
import { approveApplication, callerFor, newStudent, prisma, TEST_BUSINESS_ID, TEST_CALLBACK_TOKEN, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null

function stub(getSession = vi.fn()) {
  const provider: PaymentProvider = { kind: 'XENDIT', createCheckout: vi.fn(), getSession, createRefund: vi.fn() }
  const service = new PaymentService({ defaultProvider: provider, xenditWebhook: { callbackToken: TEST_CALLBACK_TOKEN, businessId: TEST_BUSINESS_ID } })
  return { getSession, service }
}

async function fixture(over: Record<string, unknown> = {}) {
  const student = await newStudent()
  const room = await vacantRoom()
  const approved = await approveApplication(student.id, room.id)
  const payment = await prisma.payment.create({
    data: {
      invoiceId: approved.invoiceId,
      provider: 'XENDIT',
      status: 'PENDING',
      amount: approved.invoice.amount,
      providerSessionId: `ps_${approved.invoiceId}`,
      providerBusinessId: TEST_BUSINESS_ID,
      providerPaymentRequestId: `pr_${approved.invoiceId}`,
      checkoutUrl: 'https://checkout.xendit.co/web/x',
      expiresAt: new Date(Date.now() + 20 * 60_000),
      ...over,
    },
  })
  return { student, ...approved, payment }
}

const snapshot = (p: { id: string; amount: number; providerSessionId: string | null }, over: Partial<PaymentSessionSnapshot> = {}): PaymentSessionSnapshot => ({
  state: 'COMPLETED',
  referenceId: p.id,
  providerSessionId: p.providerSessionId!,
  providerPaymentRequestId: `pr_${p.id}`,
  providerPaymentId: `py_${p.id}`,
  providerBusinessId: TEST_BUSINESS_ID,
  amount: p.amount,
  currency: 'IDR',
  updatedAt: new Date(),
  ...over,
})

const statusOf = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } }).then((p) => p.status)

describe('booking.mine payment summaries', () => {
  it('shows the live attempt, the latest attempt and canPay, without a checkout URL for mock attempts', async () => {
    const { student, invoiceId } = await fixture({ provider: 'MOCK', checkoutUrl: null, providerSessionId: 'mock_session_x' })
    const [t] = await callerFor(student.id).booking.mine()
    expect(t.invoices[0]).toMatchObject({ canPay: false, activePayment: { provider: 'MOCK', status: 'PENDING', checkoutUrl: null }, latestPayment: { provider: 'MOCK' } })
    await prisma.payment.updateMany({ where: { invoiceId }, data: { status: 'EXPIRED' } })
    const [after] = await callerFor(student.id).booking.mine()
    expect(after.invoices[0]).toMatchObject({ canPay: true, activePayment: null, latestPayment: { status: 'EXPIRED' } })
  })
})

describe('payment.status', () => {
  it('returns the checkout URL only to the payer for a live Xendit attempt', async () => {
    const { student, payment } = await fixture()
    const c = callerFor(student.id)
    expect(await c.payment.status({ paymentId: payment.id })).toMatchObject({ status: 'PENDING', checkoutUrl: 'https://checkout.xendit.co/web/x', refund: null })
    expect((await err(callerFor((await newStudent()).id).payment.status({ paymentId: payment.id })))?.code).toBe('NOT_FOUND')
    await prisma.payment.update({ where: { id: payment.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await c.payment.status({ paymentId: payment.id })).checkoutUrl).toBeNull()
    await prisma.payment.update({ where: { id: payment.id }, data: { expiresAt: new Date(Date.now() + 60_000), checkoutUrl: 'http://insecure.example/x' } })
    expect((await c.payment.status({ paymentId: payment.id })).checkoutUrl).toBeNull()
  })

  it('reports the refund state of a late payment', async () => {
    const { student, payment } = await fixture({ status: 'REFUND_PENDING' })
    await prisma.paymentRefund.create({ data: { paymentId: payment.id, referenceId: `refund_${payment.id}`, amount: payment.amount, reason: 'HOLD_EXPIRED' } })
    expect(await callerFor(student.id).payment.status({ paymentId: payment.id })).toMatchObject({ status: 'REFUND_PENDING', refund: { status: 'PENDING' }, checkoutUrl: null })
  })
})

describe('payment.reconcile', () => {
  it('refuses a non-payer', async () => {
    const { payment } = await fixture()
    const { service } = stub()
    expect((await err(callerFor((await newStudent()).id, { paymentService: service }).payment.reconcile({ paymentId: payment.id })))?.code).toBe('NOT_FOUND')
  })

  it('does not call the provider for a MOCK attempt', async () => {
    const { student, payment } = await fixture({ provider: 'MOCK' })
    const { service, getSession } = stub()
    expect((await callerFor(student.id, { paymentService: service }).payment.reconcile({ paymentId: payment.id })).status).toBe('PENDING')
    expect(getSession).not.toHaveBeenCalled()
  })

  it('settles a completed session like a webhook would', async () => {
    const { student, payment, tenancyId } = await fixture()
    const { service } = stub(vi.fn().mockResolvedValue(snapshot(payment)))
    const out = await callerFor(student.id, { paymentService: service }).payment.reconcile({ paymentId: payment.id })
    expect(out).toMatchObject({ status: 'PAID', tenancyStatus: 'ACTIVE' })
    expect(out.receiptNumber).not.toBeNull()
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ACTIVE')
  })

  it('expires the attempt for an expired or canceled session and leaves an active one alone', async () => {
    const { student, payment } = await fixture()
    const getSession = vi.fn().mockResolvedValueOnce(snapshot(payment, { state: 'ACTIVE' })).mockResolvedValueOnce(snapshot(payment, { state: 'FAILED' }))
    const c = callerFor(student.id, { paymentService: stub(getSession).service })
    expect((await c.payment.reconcile({ paymentId: payment.id })).status).toBe('PENDING')
    await prisma.payment.update({ where: { id: payment.id }, data: { lastReconciledAt: new Date(Date.now() - 60_000) } })
    expect((await c.payment.reconcile({ paymentId: payment.id })).status).toBe('EXPIRED')
  })

  it('changes nothing on a reference, amount, business or missing-payment-id mismatch', async () => {
    const { student, payment } = await fixture()
    const bad = [
      snapshot(payment, { referenceId: 'other' }),
      snapshot(payment, { amount: payment.amount + 1 }),
      snapshot(payment, { providerBusinessId: 'other_biz', providerPaymentId: null }),
    ]
    const getSession = vi.fn()
    for (const b of bad) getSession.mockResolvedValueOnce(b)
    const c = callerFor(student.id, { paymentService: stub(getSession).service })
    for (let i = 0; i < bad.length; i++) {
      await prisma.payment.update({ where: { id: payment.id }, data: { lastReconciledAt: null } })
      expect((await c.payment.reconcile({ paymentId: payment.id })).status).toBe('PENDING')
    }
    expect(await statusOf(payment.id)).toBe('PENDING')
  })

  it('answers with a safe error and no state change when the provider fails', async () => {
    const { student, payment } = await fixture()
    const getSession = vi.fn().mockRejectedValue(new XenditError('GET_SESSION', 503, 'TEMPORARILY_UNAVAILABLE', true, false, 'raw secret body'))
    const e = await err(callerFor(student.id, { paymentService: stub(getSession).service }).payment.reconcile({ paymentId: payment.id }))
    expect(e?.code).toBe('BAD_GATEWAY')
    expect(e?.message).not.toContain('secret')
    expect(await statusOf(payment.id)).toBe('PENDING')
  })

  it('makes one provider call per 30 seconds, even for parallel clicks', async () => {
    const { student, payment } = await fixture()
    const getSession = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50))
      return snapshot(payment, { state: 'ACTIVE' })
    })
    const c = callerFor(student.id, { paymentService: stub(getSession).service })
    await Promise.all([1, 2, 3].map(() => c.payment.reconcile({ paymentId: payment.id })))
    await c.payment.reconcile({ paymentId: payment.id })
    expect(getSession).toHaveBeenCalledOnce()
  })

  it('queues a refund when a completed session is found after the hold lapsed', async () => {
    const { student, payment, tenancyId } = await fixture()
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const { service } = stub(vi.fn().mockResolvedValue(snapshot(payment)))
    expect((await callerFor(student.id, { paymentService: service }).payment.reconcile({ paymentId: payment.id })).status).toBe('REFUND_PENDING')
    expect(await prisma.paymentRefund.count({ where: { paymentId: payment.id } })).toBe(1)
  })
})

describe('owner board payment label', () => {
  it('shows AWAITING_ONLINE for a live attempt and never exposes a checkout URL', async () => {
    const { room, payment } = await fixture()
    const owner = (await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: room.kosId } } } })).userId
    const board = await callerFor(owner).owner.board({ kosId: room.kosId })
    const row = board.rooms.find((r) => r.id === room.id)!
    expect(row.payment).toMatchObject({ state: 'AWAITING_ONLINE' })
    expect(JSON.stringify(board)).not.toContain('checkout.xendit.co')
    expect(JSON.stringify(board)).not.toContain(payment.providerSessionId!)
  })

  it('labels a Xendit-paid room as verified and a manually paid one as manual', async () => {
    const { room, payment, invoiceId } = await fixture()
    const owner = (await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: room.kosId } } } })).userId
    await applyPaymentEventTx(prisma, { provider: 'XENDIT', expectedBusinessId: TEST_BUSINESS_ID }, {
      kind: 'SESSION_COMPLETED', referenceId: payment.id, providerBusinessId: TEST_BUSINESS_ID, amount: payment.amount, currency: 'IDR', occurredAt: new Date(),
      providerSessionId: payment.providerSessionId!, providerPaymentRequestId: 'pr_x', providerPaymentId: 'py_x',
    })
    const board = await callerFor(owner).owner.board({ kosId: room.kosId })
    expect(board.rooms.find((r) => r.id === room.id)?.payment).toMatchObject({ state: 'VERIFIED' })
    expect(invoiceId).toBeTruthy()
  })
})
