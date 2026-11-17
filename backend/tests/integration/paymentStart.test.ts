import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import type { PaymentProvider } from '../../src/payment/provider.ts'
import { PaymentService } from '../../src/payment/service.ts'
import { XenditError } from '../../src/payment/xendit.ts'
import { approveApplication, callerFor, newStudent, prisma, vacantRoom } from '../helpers.ts'

// Real commits (no per-test rollback): the invoice row lock is what serialises the concurrent starts.
beforeEach(() => resetDb(prisma))

const errorFrom = async (promise: Promise<unknown>) => (await promise.then(() => null, (error: unknown) => error)) as TRPCError | null

let seq = 0
const sessionFor = (over: { expiresAt?: Date } = {}) => ({
  providerSessionId: `ps_${++seq}`,
  providerPaymentRequestId: `pr_${seq}`,
  providerBusinessId: 'biz_1',
  checkoutUrl: `https://checkout.xendit.co/web/ps_${seq}`,
  expiresAt: new Date(Date.now() + 25 * 60_000),
  ...over,
})

const stub = (createCheckout = vi.fn()) => {
  const provider: PaymentProvider = { kind: 'XENDIT', createCheckout, getSession: vi.fn(), createRefund: vi.fn() }
  return { provider, service: new PaymentService({ defaultProvider: provider }) }
}

const fixture = async () => {
  const student = await newStudent()
  const room = await vacantRoom()
  const approved = await approveApplication(student.id, room.id)
  return { student, invoiceId: approved.invoiceId, tenancyId: approved.tenancyId }
}

const setHold = (tenancyId: string, ms: number) => prisma.tenancy.update({ where: { id: tenancyId }, data: { expiresAt: new Date(Date.now() + ms) } })
const xErr = (code: string, unknown: boolean) => new XenditError('CREATE_SESSION', unknown ? 504 : 400, code, unknown, unknown, 'raw provider body secret')

describe('payment.start', () => {
  it('rejects anonymous, foreign and paid invoices', async () => {
    const { student, invoiceId } = await fixture()
    const { service } = stub()
    expect((await errorFrom(callerFor(null as never, { paymentService: service }).payment.start({ invoiceId })))?.code).toBe('UNAUTHORIZED')
    const other = await newStudent()
    expect((await errorFrom(callerFor(other.id, { paymentService: service }).payment.start({ invoiceId })))?.code).toBe('NOT_FOUND')
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID' } })
    expect((await errorFrom(callerFor(student.id, { paymentService: service }).payment.start({ invoiceId })))?.code).toBe('CONFLICT')
  })

  it('rejects ended and expired holds, and holds shorter than the provider minimum', async () => {
    const { student, invoiceId, tenancyId } = await fixture()
    const xendit = stub(vi.fn().mockResolvedValue(sessionFor()))
    const call = (isDemo = false) => errorFrom(callerFor(student.id, { paymentService: xendit.service, isDemo }).payment.start({ invoiceId }))

    await setHold(tenancyId, 10 * 60_000) // under Xendit's 11-minute floor
    expect((await call())?.code).toBe('CONFLICT')
    await setHold(tenancyId, 4 * 60_000) // under the mock 5-minute floor
    expect((await call(true))?.code).toBe('CONFLICT')
    await setHold(tenancyId, -1000)
    expect((await call())?.code).toBe('CONFLICT')
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { status: 'ENDED' } })
    expect((await call())?.code).toBe('CONFLICT')
    expect(await prisma.payment.count({ where: { invoiceId } })).toBe(0)
    expect(xendit.provider.createCheckout).not.toHaveBeenCalled()
  })

  it('caps the session at the tenancy hold and gives a demo user an in-app attempt that simulate can pay', async () => {
    const { student, invoiceId, tenancyId } = await fixture()
    await setHold(tenancyId, 15 * 60_000)
    const { provider, service } = stub()
    const c = callerFor(student.id, { paymentService: service, isDemo: true })
    expect((await c.payment.start({ invoiceId })).kind).toBe('DEMO')
    expect(provider.createCheckout).not.toHaveBeenCalled()
    const row = await prisma.payment.findFirstOrThrow({ where: { invoiceId } })
    expect(row).toMatchObject({ provider: 'MOCK', status: 'PENDING', providerSessionId: `mock_session_${row.id}` })
    expect(Math.abs(row.expiresAt!.getTime() - (Date.now() + 15 * 60_000))).toBeLessThan(10_000)
    await c.payment.simulate({ paymentId: row.id })
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PAID')
  })

  it('creates a Xendit redirect, stores provider ids, and reuses the live attempt', async () => {
    const { student, invoiceId } = await fixture()
    const { provider, service } = stub(vi.fn().mockImplementation(async () => sessionFor()))
    const c = callerFor(student.id, { paymentService: service })
    const first = await c.payment.start({ invoiceId })
    const second = await c.payment.start({ invoiceId })
    expect(first).toMatchObject({ kind: 'REDIRECT', checkoutUrl: expect.stringMatching(/^https:\/\/checkout\.xendit\.co\//) })
    expect(second.paymentId).toBe(first.paymentId)
    expect(provider.createCheckout).toHaveBeenCalledOnce()
    expect(vi.mocked(provider.createCheckout).mock.calls[0][0]).toMatchObject({ paymentId: first.paymentId, currency: 'IDR' })
    expect(await prisma.payment.findFirstOrThrow({ where: { invoiceId } })).toMatchObject({
      provider: 'XENDIT',
      status: 'PENDING',
      providerSessionId: expect.stringMatching(/^ps_/),
      providerPaymentRequestId: expect.stringMatching(/^pr_/),
    })
  })

  it('fails the attempt on a definite provider error without leaking provider text, and stays PROCESSING when the outcome is unknown', async () => {
    const { student, invoiceId } = await fixture()
    const createCheckout = vi.fn().mockRejectedValueOnce(xErr('INVALID_REQUEST', false)).mockRejectedValueOnce(xErr('TIMEOUT', true))
    const c = callerFor(student.id, { paymentService: stub(createCheckout).service })

    const err = await errorFrom(c.payment.start({ invoiceId }))
    expect(err?.code).toBe('BAD_GATEWAY')
    expect(err?.message).not.toContain('secret')
    expect(await prisma.payment.findFirstOrThrow({ where: { invoiceId } })).toMatchObject({ status: 'FAILED', failureCode: 'INVALID_REQUEST' })

    expect((await c.payment.start({ invoiceId })).kind).toBe('PROCESSING')
    expect(await prisma.payment.count({ where: { invoiceId, status: 'CREATING' } })).toBe(1)
    expect((await c.payment.start({ invoiceId })).kind).toBe('PROCESSING')
    expect(createCheckout).toHaveBeenCalledTimes(2)
  })

  it('expires a lapsed attempt and reaps a stale CREATING row before opening a new one', async () => {
    const { student, invoiceId } = await fixture()
    const c = callerFor(student.id, { paymentService: stub(vi.fn().mockImplementation(async () => sessionFor())).service })
    const old = await prisma.payment.create({ data: { invoiceId, provider: 'XENDIT', status: 'PENDING', amount: 1, expiresAt: new Date(Date.now() - 1000) } })
    expect((await c.payment.start({ invoiceId })).kind).toBe('REDIRECT')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('EXPIRED')

    await prisma.payment.updateMany({ where: { invoiceId, status: 'PENDING' }, data: { status: 'FAILED' } })
    const stale = await prisma.payment.create({ data: { invoiceId, provider: 'XENDIT', status: 'CREATING', amount: 1, createdAt: new Date(Date.now() - 3 * 60_000) } })
    expect((await c.payment.start({ invoiceId })).kind).toBe('REDIRECT')
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: 'FAILED', failureCode: 'STALE_CREATING' })
  })

  it('gives later invoices of an ACTIVE tenancy a full 30-minute window', async () => {
    const { student, tenancyId } = await fixture()
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { status: 'ACTIVE', expiresAt: null } })
    const later = await prisma.invoice.create({
      data: { tenancyId, periodStart: new Date(), dueDate: new Date(), amount: 100, rentAmount: 100, discountAmount: 0, applicationFeeAmount: 0, ownerReceivableAmount: 100, gatewayFeeBearer: 'PLATFORM' },
    })
    const { service } = stub(vi.fn().mockImplementation(async (i: { expiresAt: Date }) => sessionFor({ expiresAt: i.expiresAt })))
    await callerFor(student.id, { paymentService: service }).payment.start({ invoiceId: later.id })
    const row = await prisma.payment.findFirstOrThrow({ where: { invoiceId: later.id } })
    expect(Math.abs(row.expiresAt!.getTime() - (Date.now() + 30 * 60_000))).toBeLessThan(10_000)
  })

  it('leaves exactly one live attempt when starts race on one invoice', async () => {
    const { student, invoiceId } = await fixture()
    const createCheckout = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 150))
      return sessionFor()
    })
    const { service } = stub(createCheckout)
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => callerFor(student.id, { paymentService: service }).payment.start({ invoiceId })))
    expect(new Set(results.map((r) => r.paymentId)).size).toBe(1)
    expect(results.some((r) => r.kind === 'PROCESSING')).toBe(true)
    expect(createCheckout).toHaveBeenCalledOnce()
    expect(await prisma.payment.count({ where: { invoiceId, status: { in: ['CREATING', 'PENDING'] } } })).toBe(1)
  })
})
