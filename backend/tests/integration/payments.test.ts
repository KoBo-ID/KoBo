import type { TRPCError } from '@trpc/server'
import { addDays, addMonths, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { approveApplication, callerFor, createPendingMockPayment, DEMO_STUDENT_ID, postXenditWebhook, prisma, sessionWebhook, settleMock, TEST_BUSINESS_ID, TEST_CALLBACK_TOKEN, vacantRoom, cash, lapseAttempts } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const startDate = () => addDays(todayWIB(new Date()), 3)

async function book(userId = DEMO_STUDENT_ID, months = 4) {
  const room = await vacantRoom()
  const res = await approveApplication(userId, room.id, { startDate: startDate(), durationMonths: months })
  const payment = await createPendingMockPayment(res.invoiceId)
  return { room, res, payment }
}

async function bookXendit(userId = DEMO_STUDENT_ID, months = 4) {
  const room = await vacantRoom()
  const res = await approveApplication(userId, room.id, { startDate: startDate(), durationMonths: months })
  const payment = await prisma.payment.create({
    data: { invoiceId: res.invoiceId, provider: 'XENDIT', status: 'PENDING', amount: res.invoice.amount, providerSessionId: `ps_${res.invoiceId}`, providerBusinessId: TEST_BUSINESS_ID },
  })
  return { room, res, payment }
}
const auditRows = () => prisma.paymentWebhookEvent.findMany({ orderBy: { createdAt: 'asc' } })

describe('POST /api/webhooks/xendit', () => {
  it('rejects a missing or wrong callback token with 401, changes nothing and records nothing', async () => {
    const { payment } = await bookXendit()
    const body = sessionWebhook('completed', payment)
    expect((await postXenditWebhook(body, { token: null })).status).toBe(401)
    expect((await postXenditWebhook(body, { token: 'wrong' })).status).toBe(401)
    expect((await postXenditWebhook(body, { token: `${TEST_CALLBACK_TOKEN}x` })).status).toBe(401)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING')
    expect(await auditRows()).toHaveLength(0)
  })

  it('rejects invalid JSON and a known event missing required fields with 400', async () => {
    const { payment } = await bookXendit()
    expect((await postXenditWebhook('not json')).status).toBe(400)
    expect((await postXenditWebhook({ nope: 1 })).status).toBe(400)
    const body = sessionWebhook('completed', payment)
    delete (body.data as Record<string, unknown>).reference_id
    expect((await postXenditWebhook(body)).status).toBe(400)
    expect(await auditRows()).toHaveLength(0)
  })

  it('audits an unknown event and answers 200', async () => {
    expect((await postXenditWebhook({ event: 'something.else', data: { a: 1 } })).status).toBe(200)
    expect(await auditRows()).toMatchObject([{ result: 'IGNORED', reason: 'UNKNOWN_EVENT', eventType: 'something.else' }])
  })

  it('activates the booking: payment, invoice 1, tenancy, room, remaining invoices, one email and one audit row', async () => {
    const { room, res, payment } = await bookXendit(DEMO_STUDENT_ID, 4)
    expect((await postXenditWebhook(sessionWebhook('completed', payment))).status).toBe(200)

    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })
    expect(pay).toMatchObject({ status: 'PAID', providerPaymentId: `py_${payment.id}` })
    expect(pay.paidAt).not.toBeNull()
    const tenancy = await prisma.tenancy.findUniqueOrThrow({ where: { id: res.tenancyId }, include: { invoices: { orderBy: { dueDate: 'asc' } } } })
    expect(tenancy.status).toBe('ACTIVE')
    expect(tenancy.expiresAt).toBeNull()
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).occupancy).toBe('OCCUPIED')
    expect(tenancy.invoices.map((i) => i.status)).toEqual(['PAID', 'UNPAID', 'UNPAID', 'UNPAID'])
    expect(tenancy.invoices.map((i) => i.dueDate.toISOString().slice(0, 10))).toEqual([0, 1, 2, 3].map((m) => addMonths(startDate(), m)))
    expect(tenancy.invoices[0].amount).toBe(res.invoice.amount)
    expect(tenancy.invoices.slice(1).every((i) => i.amount === room.priceMonthly)).toBe(true)

    const mails = await prisma.emailOutbox.findMany({ where: { template: 'payment-received' } })
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toBe('dimas.pratama@kobo.test')
    expect((mails[0].payload as { url: string }).url).toMatch(new RegExp(`/kuitansi/${pay.receiptNo}$`))

    const audit = await auditRows()
    expect(audit).toMatchObject([{ result: 'APPLIED', reason: 'SETTLED', paymentId: payment.id, eventType: 'payment_session.completed' }])
    expect(JSON.stringify(audit[0].metadata)).not.toContain(TEST_CALLBACK_TOKEN)
  })

  it('answers 200 and audits REJECTED for a wrong business, amount, currency or session, changing nothing', async () => {
    const { payment } = await bookXendit()
    const bodies = [
      sessionWebhook('completed', payment, { businessId: 'other_biz', updated: '2026-10-14T03:01:00.000Z' }),
      sessionWebhook('completed', payment, { data: { amount: payment.amount + 1 }, updated: '2026-10-14T03:02:00.000Z' }),
      sessionWebhook('completed', payment, { data: { currency: 'USD' } }),
      sessionWebhook('completed', payment, { data: { payment_session_id: 'ps_other' } }),
    ]
    for (const body of bodies) expect((await postXenditWebhook(body)).status).toBe(200)
    expect((await auditRows()).map((r) => r.result)).toEqual(['REJECTED', 'REJECTED', 'REJECTED', 'REJECTED'])
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: 'PENDING', providerPaymentId: null })
  })

  it('answers 200 and audits IGNORED/UNMATCHED for an unknown reference', async () => {
    const body = sessionWebhook('completed', { id: 'ghost', amount: 1000, providerSessionId: 'ps_ghost' })
    expect((await postXenditWebhook(body)).status).toBe(200)
    expect(await auditRows()).toMatchObject([{ result: 'IGNORED', reason: 'UNMATCHED', paymentId: null }])
  })

  it('delivered twice or concurrently credits once and keeps one audit row', async () => {
    const { res, payment } = await bookXendit(DEMO_STUDENT_ID, 3)
    const body = sessionWebhook('completed', payment)
    expect((await postXenditWebhook(body)).status).toBe(200)
    expect((await postXenditWebhook(body)).status).toBe(200)
    await Promise.all([postXenditWebhook(body), postXenditWebhook(body), postXenditWebhook(body)])
    expect(await prisma.payment.count({ where: { status: 'PAID', invoice: { tenancyId: res.tenancyId } } })).toBe(1)
    expect(await prisma.invoice.count({ where: { tenancyId: res.tenancyId } })).toBe(3)
    expect(await prisma.emailOutbox.count({ where: { template: 'payment-received' } })).toBe(1)
    expect(await auditRows()).toHaveLength(1)
  })

  it('treats a newer update of an already-paid session as a duplicate, not a second credit', async () => {
    const { res, payment } = await bookXendit()
    await postXenditWebhook(sessionWebhook('completed', payment))
    await postXenditWebhook(sessionWebhook('completed', payment, { updated: '2026-10-14T04:00:00.000Z' }))
    expect((await auditRows()).map((r) => r.reason)).toEqual(['SETTLED', 'DUPLICATE'])
    expect(await prisma.payment.count({ where: { status: 'PAID', invoice: { tenancyId: res.tenancyId } } })).toBe(1)
  })

  it('expires the attempt on payment_session.expired and leaves the invoice payable', async () => {
    const { res, payment } = await bookXendit()
    expect((await postXenditWebhook(sessionWebhook('expired', payment))).status).toBe(200)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('EXPIRED')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: res.invoiceId } })).status).toBe('UNPAID')
  })

  it('queues a refund for a late completed event after the owner recorded the invoice manually', async () => {
    const { room, payment } = await bookXendit()
    const owner = (await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: room.kosId } } } })).userId
    await lapseAttempts(payment.invoiceId)
    await callerFor(owner).payment.recordManual(await cash(room.kosId, payment.invoiceId))
    expect((await postXenditWebhook(sessionWebhook('completed', payment))).status).toBe(200)
    expect(await prisma.paymentRefund.findUniqueOrThrow({ where: { paymentId: payment.id } })).toMatchObject({ status: 'PENDING', reason: 'INVOICE_ALREADY_PAID' })
    expect((await auditRows()).at(-1)).toMatchObject({ result: 'APPLIED', reason: 'INVOICE_ALREADY_PAID' })
  })

  it('returns 500 without recording the fingerprint on a transient failure, so the retry is processed', async () => {
    const { payment } = await bookXendit()
    const body = sessionWebhook('completed', payment)
    const spy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('connection reset'))
    expect((await postXenditWebhook(body)).status).toBe(500)
    spy.mockRestore()
    expect(await auditRows()).toHaveLength(0)
    expect((await postXenditWebhook(body)).status).toBe(200)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PAID')
  })

  it('acknowledges refund events (handled in a later task) with 200', async () => {
    const body = {
      event: 'refund.succeeded',
      business_id: TEST_BUSINESS_ID,
      created: '2026-10-14T03:00:00.000Z',
      data: { id: 'rfd-1', reference_id: 'refund_x', payment_request_id: 'pr_x', amount: 1000, currency: 'IDR', status: 'SUCCEEDED', failure_code: null, updated: '2026-10-14T03:00:00.000Z' },
    }
    expect((await postXenditWebhook(body)).status).toBe(200)
    expect(await auditRows()).toMatchObject([{ result: 'IGNORED', eventType: 'refund.succeeded' }])
  })
})

describe('payment.simulate', () => {
  it("cannot simulate someone else's payment (spec section 11)", async () => {
    const { payment } = await book(DEMO_STUDENT_ID)
    const e = await err(callerFor('user-student-5', { isDemo: true }).payment.simulate({ paymentId: payment.id }))
    expect(['FORBIDDEN', 'NOT_FOUND']).toContain(e?.code)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING')
  })

  it("pays the caller's own PENDING payment through the webhook handler", async () => {
    const { res, payment } = await book(DEMO_STUDENT_ID)
    const out = await callerFor(DEMO_STUDENT_ID, { isDemo: true }).payment.simulate({ paymentId: payment.id })
    expect(out).toMatchObject({ status: 'PAID' })
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: res.tenancyId } })).status).toBe('ACTIVE')
    expect(await prisma.emailOutbox.count({ where: { template: 'payment-received' } })).toBe(1)
    // A second click is refused and credits nothing more.
    expect((await err(callerFor(DEMO_STUDENT_ID, { isDemo: true }).payment.simulate({ paymentId: payment.id })))?.code).toBe('NOT_FOUND')
    expect(await prisma.payment.count({ where: { status: 'PAID', invoice: { tenancyId: res.tenancyId } } })).toBe(1)
  })

  it('refuses a non-demo caller outright', async () => {
    const { payment } = await book(DEMO_STUDENT_ID)
    expect((await err(callerFor(DEMO_STUDENT_ID).payment.simulate({ paymentId: payment.id })))?.code).toBe('FORBIDDEN')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING')
  })

  it('refuses a MANUAL payment', async () => {
    const { payment } = await book(DEMO_STUDENT_ID)
    await prisma.payment.update({ where: { id: payment.id }, data: { provider: 'MANUAL' } })
    expect((await err(callerFor(DEMO_STUDENT_ID, { isDemo: true }).payment.simulate({ paymentId: payment.id })))?.code).toBe('NOT_FOUND')
  })
})

describe('payment.recordManual', () => {
  const ownerOf = async (kosId: string) => (await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: kosId } } } })).userId

  it('lets the kos owner mark invoice 1 paid, which activates the tenancy like the webhook', async () => {
    const { room, res, payment } = await book(DEMO_STUDENT_ID, 3)
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenancyId: res.tenancyId } })
    await lapseAttempts(invoice.id)
    const out = await callerFor(await ownerOf(room.kosId)).payment.recordManual(await cash(room.kosId, invoice.id))
    expect(out.receiptNumber).toBeGreaterThan(0)

    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID')
    const pays = await prisma.payment.findMany({ where: { invoiceId: invoice.id } })
    expect(pays.filter((p) => p.status === 'PAID' && p.provider === 'MANUAL')).toHaveLength(1)
    expect(pays.filter((p) => p.status === 'PENDING')).toHaveLength(0)
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: res.tenancyId } })).status).toBe('ACTIVE')
    expect(await prisma.invoice.count({ where: { tenancyId: res.tenancyId } })).toBe(3)
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).occupancy).toBe('OCCUPIED')

    // The abandoned MOCK payment can no longer credit anything.
    expect((await settleMock(payment.id)).outcome).toBe('REFUND_QUEUED')
    expect(await prisma.payment.count({ where: { status: 'PAID', invoiceId: invoice.id } })).toBe(1)
  })

  it('marks a later invoice paid without touching the tenancy', async () => {
    const { room, res, payment } = await book(DEMO_STUDENT_ID, 3)
    await settleMock(payment.id)
    const next = await prisma.invoice.findFirstOrThrow({ where: { tenancyId: res.tenancyId, status: 'UNPAID' }, orderBy: { dueDate: 'asc' } })
    await lapseAttempts(next.id)
    await callerFor(await ownerOf(room.kosId)).payment.recordManual(await cash(room.kosId, next.id))
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('PAID')
    expect(await prisma.emailOutbox.count({ where: { template: 'payment-received' } })).toBe(1)
  })

  it('rejects the owner of another kos and non-owners', async () => {
    const { room, res } = await book(DEMO_STUDENT_ID)
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenancyId: res.tenancyId } })
    const other = await prisma.kos.findFirstOrThrow({ where: { ownerId: { not: room.kos.ownerId } } })
    const otherOwner = await ownerOf(other.id)
    // own kosId (passes ownerProcedure) but someone else's invoice
    expect((await err(callerFor(otherOwner).payment.recordManual(await cash(other.id, invoice.id))))?.code).toBe('NOT_FOUND')
    // claiming the victim's kosId
    expect((await err(callerFor(otherOwner).payment.recordManual(await cash(room.kosId, invoice.id))))?.code).toBe('FORBIDDEN')
    expect((await err(callerFor(DEMO_STUDENT_ID).payment.recordManual(await cash(room.kosId, invoice.id))))?.code).toBe('FORBIDDEN')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('UNPAID')
  })

  it('does not double-pay when called twice (also concurrently)', async () => {
    const { room, res } = await book(DEMO_STUDENT_ID)
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenancyId: res.tenancyId } })
    const owner = callerFor(await ownerOf(room.kosId))
    await lapseAttempts(invoice.id)
    const input = await cash(room.kosId, invoice.id)
    const results = await Promise.all([err(owner.payment.recordManual(input)), err(owner.payment.recordManual(input))])
    expect(results.filter((e) => e === null)).toHaveLength(1)
    expect(results.find((e) => e)?.code).toBe('CONFLICT')
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id, status: 'PAID' } })).toBe(1)
    expect(await prisma.emailOutbox.count({ where: { template: 'payment-received' } })).toBe(1)
  })
})
