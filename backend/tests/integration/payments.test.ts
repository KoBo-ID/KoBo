import type { TRPCError } from '@trpc/server'
import { addDays, addMonths, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, DEMO_STUDENT_ID, postWebhook, prisma, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const startDate = () => addDays(todayWIB(new Date()), 3)

async function book(userId = DEMO_STUDENT_ID, months = 4) {
  const room = await vacantRoom()
  const res = await callerFor(userId).booking.create({ roomId: room.id, startDate: startDate(), durationMonths: months })
  return { room, res }
}

describe('POST /api/webhooks/payment', () => {
  it('rejects a missing or wrong signature with 401 and changes nothing', async () => {
    const { res } = await book()
    const body = { externalId: res.payment.externalId, status: 'PAID' }
    expect((await postWebhook(body, { signature: null })).status).toBe(401)
    expect((await postWebhook(body, { signature: 'deadbeef' })).status).toBe(401)
    expect((await postWebhook(body, { secret: 'another-secret' })).status).toBe(401)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: res.payment.id } })).status).toBe('PENDING')
  })

  it('rejects a malformed body and an unknown payment (after a valid signature)', async () => {
    expect((await postWebhook({ nope: 1 })).status).toBe(400)
    expect((await postWebhook('not json')).status).toBe(400)
    expect((await postWebhook({ externalId: 'ghost', status: 'PAID' })).status).toBe(404)
  })

  it('activates the booking: payment, invoice 1, tenancy, room, remaining invoices and one email', async () => {
    const { room, res } = await book(DEMO_STUDENT_ID, 4)
    const r = await postWebhook({ externalId: res.payment.externalId, status: 'PAID' })
    expect(r.status).toBe(200)

    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: res.payment.id } })
    expect(pay.status).toBe('PAID')
    expect(pay.paidAt).not.toBeNull()
    const tenancy = await prisma.tenancy.findUniqueOrThrow({ where: { id: res.tenancyId }, include: { invoices: { orderBy: { dueDate: 'asc' } } } })
    expect(tenancy.status).toBe('ACTIVE')
    expect(tenancy.expiresAt).toBeNull()
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).occupancy).toBe('OCCUPIED')
    expect(tenancy.invoices.map((i) => i.status)).toEqual(['PAID', 'UNPAID', 'UNPAID', 'UNPAID'])
    expect(tenancy.invoices.map((i) => i.dueDate.toISOString().slice(0, 10))).toEqual([0, 1, 2, 3].map((m) => addMonths(startDate(), m)))
    expect(tenancy.invoices[0].amount).toBe(res.breakdown.total)
    expect(tenancy.invoices.slice(1).every((i) => i.amount === room.priceMonthly)).toBe(true)

    const mails = await prisma.emailOutbox.findMany({ where: { template: 'payment-received' } })
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toBe('demo-student@kobo.test')
    expect((mails[0].payload as { url: string }).url).toMatch(new RegExp(`/kuitansi/${pay.receiptNo}$`))
  })

  it('delivered twice credits once (spec section 11)', async () => {
    const { res } = await book(DEMO_STUDENT_ID, 3)
    const body = { externalId: res.payment.externalId, status: 'PAID' }
    expect((await postWebhook(body)).status).toBe(200)
    expect((await postWebhook(body)).status).toBe(200)
    // ... and concurrently
    await Promise.all([postWebhook(body), postWebhook(body), postWebhook(body)])

    expect(await prisma.payment.count({ where: { status: 'PAID', invoice: { tenancyId: res.tenancyId } } })).toBe(1)
    expect(await prisma.invoice.count({ where: { tenancyId: res.tenancyId } })).toBe(3)
    expect(await prisma.emailOutbox.count({ where: { template: 'payment-received' } })).toBe(1)
  })
})

describe('payment.simulate', () => {
  it("cannot simulate someone else's payment (spec section 11)", async () => {
    const { res } = await book(DEMO_STUDENT_ID)
    const e = await err(callerFor('user-student-5').payment.simulate({ paymentId: res.payment.id }))
    expect(['FORBIDDEN', 'NOT_FOUND']).toContain(e?.code)
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: res.payment.id } })).status).toBe('PENDING')
  })

  it("pays the caller's own PENDING payment through the webhook handler", async () => {
    const { res } = await book(DEMO_STUDENT_ID)
    const out = await callerFor(DEMO_STUDENT_ID).payment.simulate({ paymentId: res.payment.id })
    expect(out).toMatchObject({ status: 'PAID' })
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: res.tenancyId } })).status).toBe('ACTIVE')
    expect(await prisma.emailOutbox.count({ where: { template: 'payment-received' } })).toBe(1)
    // A second click is refused and credits nothing more.
    expect((await err(callerFor(DEMO_STUDENT_ID).payment.simulate({ paymentId: res.payment.id })))?.code).toBe('NOT_FOUND')
    expect(await prisma.payment.count({ where: { status: 'PAID', invoice: { tenancyId: res.tenancyId } } })).toBe(1)
  })

  it('refuses a MANUAL payment', async () => {
    const { res } = await book(DEMO_STUDENT_ID)
    await prisma.payment.update({ where: { id: res.payment.id }, data: { provider: 'MANUAL' } })
    expect((await err(callerFor(DEMO_STUDENT_ID).payment.simulate({ paymentId: res.payment.id })))?.code).toBe('NOT_FOUND')
  })
})

describe('payment.recordManual', () => {
  const ownerOf = async (kosId: string) => (await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: kosId } } } })).userId

  it('lets the kos owner mark invoice 1 paid, which activates the tenancy like the webhook', async () => {
    const { room, res } = await book(DEMO_STUDENT_ID, 3)
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenancyId: res.tenancyId } })
    const out = await callerFor(await ownerOf(room.kosId)).payment.recordManual({ kosId: room.kosId, invoiceId: invoice.id })
    expect(out.receiptNumber).toBeGreaterThan(0)

    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID')
    const pays = await prisma.payment.findMany({ where: { invoiceId: invoice.id } })
    expect(pays.filter((p) => p.status === 'PAID' && p.provider === 'MANUAL')).toHaveLength(1)
    expect(pays.filter((p) => p.status === 'PENDING')).toHaveLength(0)
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: res.tenancyId } })).status).toBe('ACTIVE')
    expect(await prisma.invoice.count({ where: { tenancyId: res.tenancyId } })).toBe(3)
    expect((await prisma.room.findUniqueOrThrow({ where: { id: room.id } })).occupancy).toBe('OCCUPIED')

    // The abandoned MOCK payment can no longer credit anything.
    expect((await postWebhook({ externalId: res.payment.externalId, status: 'PAID' })).status).toBe(200)
    expect(await prisma.payment.count({ where: { status: 'PAID', invoiceId: invoice.id } })).toBe(1)
  })

  it('marks a later invoice paid without touching the tenancy', async () => {
    const { room, res } = await book(DEMO_STUDENT_ID, 3)
    await postWebhook({ externalId: res.payment.externalId, status: 'PAID' })
    const next = await prisma.invoice.findFirstOrThrow({ where: { tenancyId: res.tenancyId, status: 'UNPAID' }, orderBy: { dueDate: 'asc' } })
    await callerFor(await ownerOf(room.kosId)).payment.recordManual({ kosId: room.kosId, invoiceId: next.id })
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('PAID')
    expect(await prisma.emailOutbox.count({ where: { template: 'payment-received' } })).toBe(1)
  })

  it('rejects the owner of another kos and non-owners', async () => {
    const { room, res } = await book(DEMO_STUDENT_ID)
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenancyId: res.tenancyId } })
    const other = await prisma.kos.findFirstOrThrow({ where: { ownerId: { not: room.kos.ownerId } } })
    const otherOwner = await ownerOf(other.id)
    // own kosId (passes ownerProcedure) but someone else's invoice
    expect((await err(callerFor(otherOwner).payment.recordManual({ kosId: other.id, invoiceId: invoice.id })))?.code).toBe('NOT_FOUND')
    // claiming the victim's kosId
    expect((await err(callerFor(otherOwner).payment.recordManual({ kosId: room.kosId, invoiceId: invoice.id })))?.code).toBe('FORBIDDEN')
    expect((await err(callerFor(DEMO_STUDENT_ID).payment.recordManual({ kosId: room.kosId, invoiceId: invoice.id })))?.code).toBe('FORBIDDEN')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('UNPAID')
  })

  it('does not double-pay when called twice (also concurrently)', async () => {
    const { room, res } = await book(DEMO_STUDENT_ID)
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { tenancyId: res.tenancyId } })
    const owner = callerFor(await ownerOf(room.kosId))
    const input = { kosId: room.kosId, invoiceId: invoice.id }
    const results = await Promise.all([err(owner.payment.recordManual(input)), err(owner.payment.recordManual(input))])
    expect(results.filter((e) => e === null)).toHaveLength(1)
    expect(results.find((e) => e)?.code).toBe('CONFLICT')
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id, status: 'PAID' } })).toBe(1)
    expect(await prisma.emailOutbox.count({ where: { template: 'payment-received' } })).toBe(1)
  })
})
