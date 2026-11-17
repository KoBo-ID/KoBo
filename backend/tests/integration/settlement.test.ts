import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { renderEmail } from '../../src/emailTemplates.ts'
import type { NormalizedPaymentEvent } from '../../src/payment/provider.ts'
import { applyPaymentEventTx } from '../../src/payment/settlement.ts'
import { approveApplication, callerFor, newStudent, prisma, vacantRoom, cash, lapseAttempts } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const BIZ = 'biz_test'
const opts = (over: Partial<Parameters<typeof applyPaymentEventTx>[1]> = {}) => ({ provider: 'XENDIT' as const, expectedBusinessId: BIZ, ...over })

async function fixture() {
  const student = await newStudent()
  const room = await vacantRoom()
  const approved = await approveApplication(student.id, room.id, { durationMonths: 3 })
  return { student, ...approved }
}

let seq = 0
async function attempt(invoiceId: string, over: Record<string, unknown> = {}) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { amount: true } })
  seq++
  return prisma.payment.create({
    data: { invoiceId, provider: 'XENDIT', status: 'PENDING', amount: invoice.amount, providerSessionId: `ps_${seq}`, providerBusinessId: BIZ, expiresAt: new Date(Date.now() + 20 * 60_000), ...over },
  })
}

const completed = (p: { id: string; amount: number; providerSessionId: string | null }, over: Partial<Extract<NormalizedPaymentEvent, { kind: 'SESSION_COMPLETED' }>> = {}): NormalizedPaymentEvent => ({
  kind: 'SESSION_COMPLETED',
  referenceId: p.id,
  providerBusinessId: BIZ,
  amount: p.amount,
  currency: 'IDR',
  occurredAt: new Date(),
  providerSessionId: p.providerSessionId ?? `ps_${p.id}`,
  providerPaymentRequestId: `pr_${p.id}`,
  providerPaymentId: `pay_${p.id}`,
  ...over,
})

const emails = () => prisma.emailOutbox.count({ where: { template: 'payment-received' } })

describe('applyPaymentEvent: completed', () => {
  it('settles the first invoice: payment, invoice, tenancy, room, later invoices and one email', async () => {
    const { invoiceId, tenancyId, room } = await fixture()
    const p = await attempt(invoiceId)
    const res = await applyPaymentEventTx(prisma, opts(), completed(p))
    expect(res).toMatchObject({ outcome: 'SETTLED', paymentId: p.id })
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'PAID', providerPaymentId: `pay_${p.id}`, providerPaymentRequestId: `pr_${p.id}` })
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('PAID')
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ACTIVE')
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).occupancy).toBe('OCCUPIED')
    expect(await prisma.invoice.count({ where: { tenancyId } })).toBe(3)
    expect(await emails()).toBe(1)
    // The owner is told about the same settlement, once, and the copy never promises a payout.
    const ownerMails = await prisma.emailOutbox.findMany({ where: { template: 'payment-received-owner' } })
    expect(ownerMails).toHaveLength(1)
    expect(renderEmail('payment-received-owner', ownerMails[0].payload)?.text).toContain('terverifikasi')
    expect(renderEmail('payment-received-owner', ownerMails[0].payload)?.text).toContain('bukan pemberitahuan pencairan dana')
  })

  it('is idempotent, sequentially and under concurrent delivery', async () => {
    const { invoiceId, tenancyId } = await fixture()
    const p = await attempt(invoiceId)
    const results = await Promise.all([1, 2, 3].map(() => applyPaymentEventTx(prisma, opts(), completed(p))))
    expect(results.filter((r) => r.outcome === 'SETTLED')).toHaveLength(1)
    expect(results.filter((r) => r.outcome === 'DUPLICATE')).toHaveLength(2)
    expect((await applyPaymentEventTx(prisma, opts(), completed(p))).outcome).toBe('DUPLICATE')
    expect(await prisma.invoice.count({ where: { tenancyId } })).toBe(3)
    expect(await emails()).toBe(1)
    expect(await prisma.paymentRefund.count()).toBe(0)
  })

  it('rejects every mismatch without touching the attempt, and reports an unknown reference', async () => {
    const { invoiceId } = await fixture()
    const p = await attempt(invoiceId)
    const cases: [string, Parameters<typeof applyPaymentEventTx>[1], Partial<Extract<NormalizedPaymentEvent, { kind: 'SESSION_COMPLETED' }>>][] = [
      ['PROVIDER_MISMATCH', opts({ provider: 'MOCK' }), {}],
      ['BUSINESS_MISMATCH', opts(), { providerBusinessId: 'other' }],
      ['SESSION_MISMATCH', opts(), { providerSessionId: 'ps_other' }],
      ['CURRENCY_MISMATCH', opts(), { currency: 'USD' as 'IDR' }],
      ['AMOUNT_MISMATCH', opts(), { amount: p.amount + 1 }],
      ['AMOUNT_MISMATCH', opts(), { amount: p.amount - 1 }],
    ]
    for (const [reason, o, over] of cases) {
      expect(await applyPaymentEventTx(prisma, o, completed(p, over))).toMatchObject({ outcome: 'REJECTED', reason })
    }
    expect((await applyPaymentEventTx(prisma, opts(), completed({ id: 'ghost', amount: 1, providerSessionId: null }))).outcome).toBe('UNMATCHED')
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'PENDING', providerPaymentId: null })
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('UNPAID')
  })

  it('settles an attempt that was failed by crash recovery before the money arrived', async () => {
    const { invoiceId } = await fixture()
    const p = await attempt(invoiceId, { status: 'FAILED', failureCode: 'STALE_CREATING', providerSessionId: null, providerBusinessId: null })
    expect((await applyPaymentEventTx(prisma, opts(), completed(p))).outcome).toBe('SETTLED')
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'PAID', providerSessionId: `ps_${p.id}`, providerBusinessId: BIZ })
  })

  it('pays the first attempt and queues a refund for the second, which fulfilment also supersedes', async () => {
    const { invoiceId } = await fixture()
    const a = await attempt(invoiceId, { status: 'EXPIRED' })
    const b = await attempt(invoiceId)
    expect((await applyPaymentEventTx(prisma, opts(), completed(a))).outcome).toBe('SETTLED')
    expect(await applyPaymentEventTx(prisma, opts(), completed(b))).toMatchObject({ outcome: 'REFUND_QUEUED', reason: 'INVOICE_ALREADY_PAID' })
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: 'REFUND_PENDING', providerPaymentId: `pay_${b.id}` })
    expect(await prisma.paymentRefund.findUniqueOrThrow({ where: { paymentId: b.id } })).toMatchObject({ referenceId: `refund_${b.id}`, amount: b.amount, status: 'PENDING', reason: 'INVOICE_ALREADY_PAID' })
    expect(await prisma.payment.count({ where: { invoiceId, status: 'PAID' } })).toBe(1)
  })

  it('supersedes the other live attempt when one wins, and refunds it if its money still arrives', async () => {
    const { invoiceId } = await fixture()
    const a = await attempt(invoiceId, { status: 'EXPIRED' })
    const live = await attempt(invoiceId)
    expect((await applyPaymentEventTx(prisma, opts(), completed(a))).outcome).toBe('SETTLED')
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: live.id } })).toMatchObject({ status: 'FAILED', failureCode: 'SUPERSEDED' })
    expect((await applyPaymentEventTx(prisma, opts(), completed(live))).outcome).toBe('REFUND_QUEUED')
  })

  it('refunds instead of reviving a lapsed hold or an ended tenancy, leaving invoice and tenancy untouched', async () => {
    const { invoiceId, tenancyId, room } = await fixture()
    const p = await attempt(invoiceId)
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await applyPaymentEventTx(prisma, opts(), completed(p))).toMatchObject({ outcome: 'REFUND_QUEUED', reason: 'HOLD_EXPIRED' })
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('UNPAID')
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('PENDING')
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).occupancy).not.toBe('OCCUPIED')

    const q = await attempt(invoiceId)
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { status: 'ENDED' } })
    expect(await applyPaymentEventTx(prisma, opts(), completed(q))).toMatchObject({ outcome: 'REFUND_QUEUED', reason: 'TENANCY_ENDED' })
    expect(await prisma.paymentRefund.count()).toBe(2)
    expect(await emails()).toBe(0)
  })

  it('refunds when the owner already recorded the invoice manually', async () => {
    const { invoiceId, tenancyId } = await fixture()
    const kos = await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId }, select: { room: { select: { kosId: true, kos: { select: { owner: { select: { userId: true } } } } } } } })
    const p = await attempt(invoiceId)
    await lapseAttempts(invoiceId)
    await callerFor(kos.room.kos.owner.userId).payment.recordManual(await cash(kos.room.kosId, invoiceId))
    const res = await applyPaymentEventTx(prisma, opts(), completed(p))
    expect(res).toMatchObject({ outcome: 'REFUND_QUEUED', reason: 'INVOICE_ALREADY_PAID' })
    expect(await prisma.paymentRefund.count({ where: { paymentId: p.id } })).toBe(1)
    expect(await prisma.payment.count({ where: { invoiceId, status: 'PAID' } })).toBe(1)
  })

  it('settles a later monthly invoice without touching the tenancy', async () => {
    const { tenancyId } = await fixture()
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { status: 'ACTIVE', expiresAt: null } })
    const later = await prisma.invoice.create({
      data: { tenancyId, periodStart: new Date(), dueDate: new Date(Date.now() + 86_400_000), amount: 100, rentAmount: 100, discountAmount: 0, applicationFeeAmount: 0, ownerReceivableAmount: 100, gatewayFeeBearer: 'PLATFORM' },
    })
    const before = await prisma.invoice.count({ where: { tenancyId } })
    const p = await attempt(later.id)
    expect((await applyPaymentEventTx(prisma, opts(), completed(p))).outcome).toBe('SETTLED')
    expect(await prisma.invoice.count({ where: { tenancyId } })).toBe(before)
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ACTIVE')
  })

  it('treats repeated events on refund states as duplicates with a single refund row', async () => {
    const { invoiceId, tenancyId } = await fixture()
    const p = await attempt(invoiceId)
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await applyPaymentEventTx(prisma, opts(), completed(p))
    expect((await applyPaymentEventTx(prisma, opts(), completed(p))).outcome).toBe('DUPLICATE')
    await prisma.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } })
    expect((await applyPaymentEventTx(prisma, opts(), completed(p))).outcome).toBe('DUPLICATE')
    expect(await prisma.paymentRefund.count()).toBe(1)
  })
})

describe('applyPaymentEvent: expired', () => {
  it('expires a live attempt, ignores a paid one, and leaves the invoice payable', async () => {
    const { student, invoiceId } = await fixture()
    const p = await attempt(invoiceId)
    const expired = (id: string, sessionId: string): NormalizedPaymentEvent => ({ kind: 'SESSION_EXPIRED', referenceId: id, providerBusinessId: BIZ, amount: p.amount, currency: 'IDR', occurredAt: new Date(), providerSessionId: sessionId })
    expect((await applyPaymentEventTx(prisma, opts(), expired(p.id, p.providerSessionId!))).outcome).toBe('EXPIRED')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('EXPIRED')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('UNPAID')
    expect((await applyPaymentEventTx(prisma, opts(), expired(p.id, p.providerSessionId!))).outcome).toBe('IGNORED')
    expect((await callerFor(student.id, { isDemo: true }).payment.start({ invoiceId })).kind).toBe('DEMO')
  })
})
