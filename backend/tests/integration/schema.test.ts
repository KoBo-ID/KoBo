import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

async function freeRoom() {
  const room = await prisma.room.findFirstOrThrow({ where: { tenancies: { none: { status: { in: ['PENDING', 'ACTIVE'] } } } } })
  const user = await prisma.user.findFirstOrThrow({ where: { isDemo: true, ownerProfile: null } })
  return { room, user }
}
const tenancy = (roomId: string, userId: string, status: 'PENDING' | 'ACTIVE' | 'ENDED') =>
  prisma.tenancy.create({ data: { roomId, userId, status, startDate: new Date(), durationMonths: 6 } })

describe('resetDb', () => {
  it('truncates and reseeds in under 2 s, restarting identity', async () => {
    const t = performance.now()
    await resetDb(prisma)
    expect(performance.now() - t).toBeLessThan(2000)
    const first = await prisma.payment.findFirstOrThrow({ orderBy: { receiptNo: 'asc' } })
    expect(first.receiptNo).toBe(1)
  })

  it('is deterministic for a fixed clock', async () => {
    const now = new Date('2026-10-01T05:00:00Z')
    const snap = () => prisma.review.findMany({ orderBy: { id: 'asc' }, select: { id: true, rating: true, comment: true } })
    await resetDb(prisma, { now })
    const a = await snap()
    await resetDb(prisma, { now })
    expect(await snap()).toEqual(a)
  })

  it('seeds a verified demo student and a demo owner who owns the first kos', async () => {
    const student = await prisma.user.findUniqueOrThrow({ where: { email: 'demo-student@kobo.test' } })
    expect(student.isDemo).toBe(true)
    expect(student.campusEmailVerifiedAt).not.toBeNull()
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'demo-owner@kobo.test' },
      include: { ownerProfile: { include: { kos: { orderBy: { createdAt: 'asc' } } } } },
    })
    expect(owner.isDemo).toBe(true)
    expect(owner.ownerProfile!.kos[0].id).toBe('kos-1')
  })
})

describe('tenancy_one_active_per_room (partial unique index)', () => {
  it('rejects a second PENDING or ACTIVE tenancy on the same room', async () => {
    const { room, user } = await freeRoom()
    await tenancy(room.id, user.id, 'PENDING')
    await expect(tenancy(room.id, user.id, 'PENDING')).rejects.toThrow()
    await expect(tenancy(room.id, user.id, 'ACTIVE')).rejects.toThrow()
  })

  it('allows any number of ENDED tenancies beside one live one', async () => {
    const { room, user } = await freeRoom()
    await tenancy(room.id, user.id, 'ENDED')
    await tenancy(room.id, user.id, 'ENDED')
    await tenancy(room.id, user.id, 'ACTIVE')
  })
})

describe('CHECK constraints', () => {
  it('rejects negative money, out-of-range ratings and non-positive durations', async () => {
    const { room, user } = await freeRoom()
    await expect(prisma.room.update({ where: { id: room.id }, data: { priceMonthly: -1 } })).rejects.toThrow()
    await expect(
      prisma.tenancy.create({ data: { roomId: room.id, userId: user.id, status: 'ENDED', startDate: new Date(), durationMonths: 0 } }),
    ).rejects.toThrow()
    const ended = await tenancy(room.id, user.id, 'ENDED')
    await expect(prisma.review.create({ data: { tenancyId: ended.id, rating: 6, comment: 'x' } })).rejects.toThrow()
    await expect(prisma.review.create({ data: { tenancyId: ended.id, rating: 0, comment: 'x' } })).rejects.toThrow()
    await prisma.review.create({ data: { tenancyId: ended.id, rating: 5, comment: 'ok' } })
    await expect(prisma.review.create({ data: { tenancyId: ended.id, rating: 4, comment: 'twice' } })).rejects.toThrow()
  })
})

async function invoiceForGatewaySchema() {
  const { room, user } = await freeRoom()
  const lease = await tenancy(room.id, user.id, 'ENDED')
  return prisma.invoice.create({
    data: {
      tenancyId: lease.id,
      periodStart: new Date('2026-10-01T00:00:00Z'),
      dueDate: new Date('2026-10-05T00:00:00Z'),
      amount: 1_025_000,
      rentAmount: 1_100_000,
      discountAmount: 100_000,
      applicationFeeAmount: 25_000,
      ownerReceivableAmount: 1_000_000,
      gatewayFeeBearer: 'PLATFORM',
    },
  })
}

describe('payment gateway schema', () => {
  it('rejects an invoice writer that omits the allocation snapshot', async () => {
    const { room, user } = await freeRoom()
    const lease = await tenancy(room.id, user.id, 'ENDED')
    await expect(
      prisma.invoice.create({
        data: {
          tenancyId: lease.id,
          periodStart: new Date('2026-10-01T00:00:00Z'),
          dueDate: new Date('2026-10-05T00:00:00Z'),
          amount: 1_000_000,
        } as never,
      }),
    ).rejects.toThrow()
  })

  it('persists the immutable invoice allocation snapshot', async () => {
    const invoice = await invoiceForGatewaySchema()

    expect(invoice).toMatchObject({
      amount: 1_025_000,
      rentAmount: 1_100_000,
      discountAmount: 100_000,
      applicationFeeAmount: 25_000,
      ownerReceivableAmount: 1_000_000,
      gatewayFeeBearer: 'PLATFORM',
    })
  })

  it.each([
    ['amount', { amount: -1 }],
    ['rentAmount', { rentAmount: -1 }],
    ['discountAmount', { discountAmount: -1 }],
    ['applicationFeeAmount', { applicationFeeAmount: -1 }],
    ['ownerReceivableAmount', { ownerReceivableAmount: -1 }],
  ] as const)('rejects a negative %s', async (_field, data) => {
    const invoice = await invoiceForGatewaySchema()
    await expect(prisma.invoice.update({ where: { id: invoice.id }, data })).rejects.toThrow()
  })

  it('rejects a discount greater than rent', async () => {
    const invoice = await invoiceForGatewaySchema()
    await expect(
      prisma.invoice.update({ where: { id: invoice.id }, data: { discountAmount: invoice.rentAmount + 1 } }),
    ).rejects.toThrow()
  })

  it('requires owner receivable to equal rent after discount', async () => {
    const invoice = await invoiceForGatewaySchema()
    await expect(
      prisma.invoice.update({ where: { id: invoice.id }, data: { ownerReceivableAmount: invoice.ownerReceivableAmount - 1 } }),
    ).rejects.toThrow()
  })

  it('requires the invoice total to equal owner receivable plus application fee', async () => {
    const invoice = await invoiceForGatewaySchema()
    await expect(prisma.invoice.update({ where: { id: invoice.id }, data: { amount: invoice.amount - 1 } })).rejects.toThrow()
  })

  it('allows payment history but rejects two live online attempts for one invoice', async () => {
    const invoice = await invoiceForGatewaySchema()

    await prisma.payment.create({ data: { invoiceId: invoice.id, provider: 'XENDIT', amount: invoice.amount, status: 'FAILED' } })
    await prisma.payment.create({ data: { invoiceId: invoice.id, provider: 'MOCK', amount: invoice.amount, status: 'EXPIRED' } })
    await prisma.payment.create({ data: { invoiceId: invoice.id, provider: 'XENDIT', amount: invoice.amount, status: 'CREATING' } })

    await expect(
      prisma.payment.create({ data: { invoiceId: invoice.id, provider: 'MOCK', amount: invoice.amount, status: 'PENDING' } }),
    ).rejects.toThrow()
  })

  it.each(['providerSessionId', 'providerPaymentRequestId', 'providerPaymentId'] as const)(
    'keeps %s unique when a provider retries',
    async (field) => {
      const firstInvoice = await invoiceForGatewaySchema()
      const secondInvoice = await invoiceForGatewaySchema()
      const providerId = `${field}-same-provider-id`

      await prisma.payment.create({
        data: { invoiceId: firstInvoice.id, provider: 'XENDIT', amount: firstInvoice.amount, status: 'FAILED', [field]: providerId },
      })
      await expect(
        prisma.payment.create({
          data: { invoiceId: secondInvoice.id, provider: 'XENDIT', amount: secondInvoice.amount, status: 'FAILED', [field]: providerId },
        }),
      ).rejects.toThrow()
    },
  )

  it('deduplicates webhook fingerprints and records sanitized processing details', async () => {
    const invoice = await invoiceForGatewaySchema()
    const payment = await prisma.payment.create({
      data: { invoiceId: invoice.id, provider: 'XENDIT', amount: invoice.amount, status: 'PENDING' },
    })
    const data = {
      provider: 'XENDIT' as const,
      fingerprint: 'payment_session.completed:session-1:2026-10-13T08:00:00Z',
      eventType: 'payment_session.completed',
      externalResourceId: 'session-1',
      paymentId: payment.id,
      result: 'APPLIED' as const,
      reason: 'PAYMENT_SETTLED',
      metadata: { currency: 'IDR', amount: invoice.amount },
      processedAt: new Date(),
    }

    await prisma.paymentWebhookEvent.create({ data })
    await expect(prisma.paymentWebhookEvent.create({ data })).rejects.toThrow()
  })

  it('keeps one refund per payment with globally stable references', async () => {
    const firstInvoice = await invoiceForGatewaySchema()
    const secondInvoice = await invoiceForGatewaySchema()
    const firstPayment = await prisma.payment.create({
      data: { invoiceId: firstInvoice.id, provider: 'XENDIT', amount: firstInvoice.amount, status: 'REFUND_PENDING' },
    })
    const secondPayment = await prisma.payment.create({
      data: { invoiceId: secondInvoice.id, provider: 'XENDIT', amount: secondInvoice.amount, status: 'REFUND_PENDING' },
    })

    await prisma.paymentRefund.create({
      data: { paymentId: firstPayment.id, referenceId: 'refund-payment-1', amount: firstPayment.amount, reason: 'TENANCY_EXPIRED' },
    })
    await expect(
      prisma.paymentRefund.create({
        data: { paymentId: firstPayment.id, referenceId: 'refund-payment-2', amount: firstPayment.amount, reason: 'DUPLICATE_PAYMENT' },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.paymentRefund.create({
        data: { paymentId: secondPayment.id, referenceId: 'refund-payment-1', amount: secondPayment.amount, reason: 'DUPLICATE_PAYMENT' },
      }),
    ).rejects.toThrow()
  })

  it('requires a positive refund amount and non-negative attempt count', async () => {
    const invoice = await invoiceForGatewaySchema()
    const payment = await prisma.payment.create({
      data: { invoiceId: invoice.id, provider: 'XENDIT', amount: invoice.amount, status: 'REFUND_PENDING' },
    })

    await expect(
      prisma.paymentRefund.create({
        data: { paymentId: payment.id, referenceId: 'refund-zero', amount: 0, reason: 'TENANCY_EXPIRED' },
      }),
    ).rejects.toThrow()

    const refund = await prisma.paymentRefund.create({
      data: { paymentId: payment.id, referenceId: 'refund-valid', amount: payment.amount, reason: 'TENANCY_EXPIRED' },
    })
    await expect(prisma.paymentRefund.update({ where: { id: refund.id }, data: { attempts: -1 } })).rejects.toThrow()
  })

  it.each(['invoice', 'tenancy'] as const)('does not erase a refund obligation when deleting its %s', async (target) => {
    const invoice = await invoiceForGatewaySchema()
    const payment = await prisma.payment.create({
      data: { invoiceId: invoice.id, provider: 'XENDIT', amount: invoice.amount, status: 'REFUND_PENDING' },
    })
    await prisma.paymentRefund.create({
      data: { paymentId: payment.id, referenceId: `refund-delete-${target}`, amount: payment.amount, reason: 'TENANCY_EXPIRED' },
    })

    const deletion =
      target === 'invoice'
        ? prisma.invoice.delete({ where: { id: invoice.id } })
        : prisma.tenancy.delete({ where: { id: invoice.tenancyId } })
    await expect(deletion).rejects.toThrow()
    await expect(prisma.paymentRefund.findUniqueOrThrow({ where: { paymentId: payment.id } })).resolves.toBeDefined()
  })

  it('attributes a manual payment to the owner who recorded it', async () => {
    const invoice = await invoiceForGatewaySchema()
    const owner = await prisma.user.findFirstOrThrow({ where: { ownerProfile: { isNot: null } } })

    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        provider: 'MANUAL',
        amount: invoice.amount,
        status: 'PAID',
        manualMethod: 'BANK_TRANSFER',
        manualReference: 'BCA-20261013-001',
        manualNote: 'Diperiksa dari mutasi rekening.',
        recordedById: owner.id,
      },
      include: { recordedBy: true },
    })

    expect(payment).toMatchObject({
      manualMethod: 'BANK_TRANSFER',
      manualReference: 'BCA-20261013-001',
      manualNote: 'Diperiksa dari mutasi rekening.',
      recordedBy: { id: owner.id },
    })
  })

  it('stores owner Xendit readiness separately from KoBo verification', async () => {
    const owner = await prisma.ownerProfile.findFirstOrThrow()
    const updated = await prisma.ownerProfile.update({
      where: { id: owner.id },
      data: {
        xenditSubaccountId: 'subaccount-test-1',
        xenditOnboardingStatus: 'VERIFIED',
        xenditVerifiedAt: new Date('2026-10-13T08:00:00Z'),
      },
    })

    expect(updated).toMatchObject({
      verified: owner.verified,
      xenditSubaccountId: 'subaccount-test-1',
      xenditOnboardingStatus: 'VERIFIED',
      xenditVerifiedAt: new Date('2026-10-13T08:00:00Z'),
    })
  })
})
