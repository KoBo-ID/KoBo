import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { loadBoardRooms } from '../../src/ownerBoard.ts'
import { isLiveAttempt, toPaymentSummary } from '../../src/payment/summary.ts'
import { startPaymentAttempt } from '../../src/payment/attempts.ts'
import { MockPaymentProvider } from '../../src/payment/mock.ts'
import { applyPaymentEventTx } from '../../src/payment/settlement.ts'
import { approveApplication, callerFor, cash, newStudent, prisma, TEST_BUSINESS_ID, vacantRoom } from '../helpers.ts'
import { code } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

async function boardRoom(roomId: string, kosId: string, now = new Date()) {
  const rooms = (await loadBoardRooms(prisma, [kosId], now)).get(kosId)!
  return rooms.find((r) => r.id === roomId)!
}
const ownerOf = async (room: { kos: { ownerId: string } }) => (await prisma.ownerProfile.findUniqueOrThrow({ where: { id: room.kos.ownerId } })).userId

describe('[A-003] owner board reaches the refund states', () => {
  it('a late payment on a lapsed hold shows REFUND_PENDING on the (vacant) room', async () => {
    const room = await vacantRoom()
    const { invoiceId, tenancyId } = await approveApplication((await newStudent()).id, room.id)
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { expiresAt: new Date(Date.now() - 60_000) } })
    await prisma.payment.create({ data: { invoiceId, provider: 'XENDIT', status: 'REFUND_PENDING', amount: 1000, paidAt: new Date() } })
    const r = await boardRoom(room.id, room.kosId)
    expect(r.status).toBe('vacant')
    expect(r.payment).toEqual({ state: 'REFUND_PENDING', expiresAt: null })
  })

  it('a refund on an already-paid invoice shows REFUNDED, a failed refund wins as NEEDS_REVIEW, an old refund fades', async () => {
    const room = await vacantRoom()
    const { invoiceId, tenancyId } = await approveApplication((await newStudent()).id, room.id)
    await callerFor(await ownerOf(room)).payment.recordManual(await cash(room.kosId, invoiceId))
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ACTIVE')
    const dup = await prisma.payment.create({ data: { invoiceId, provider: 'XENDIT', status: 'REFUNDED', amount: 1000, paidAt: new Date(), refundedAt: new Date() } })
    expect((await boardRoom(room.id, room.kosId)).payment).toEqual({ state: 'REFUNDED', expiresAt: null })
    await prisma.payment.create({ data: { invoiceId, provider: 'XENDIT', status: 'REFUND_FAILED', amount: 1000, paidAt: new Date() } })
    expect((await boardRoom(room.id, room.kosId)).payment).toEqual({ state: 'NEEDS_REVIEW', expiresAt: null })
    await prisma.payment.deleteMany({ where: { status: 'REFUND_FAILED' } })
    await prisma.payment.update({ where: { id: dup.id }, data: { refundedAt: new Date(Date.now() - 30 * 86_400_000) } })
    expect((await boardRoom(room.id, room.kosId)).payment?.state).not.toBe('REFUNDED')
  })
})

describe('[A-006] invoices #2..N keep the agreed rent', () => {
  it('an owner price change after approval does not change later invoices', async () => {
    const room = await vacantRoom()
    const { invoiceId, tenancyId, invoice } = await approveApplication((await newStudent()).id, room.id, { durationMonths: 3 })
    const agreed = invoice.rentAmount
    await prisma.room.update({ where: { id: room.id }, data: { priceMonthly: room.priceMonthly + 500_000 } })
    await callerFor(await ownerOf(room)).payment.recordManual(await cash(room.kosId, invoiceId))
    const later = await prisma.invoice.findMany({ where: { tenancyId, id: { not: invoiceId } } })
    expect(later).toHaveLength(2)
    for (const i of later) expect([i.amount, i.rentAmount, i.ownerReceivableAmount]).toEqual([agreed, agreed, agreed])
    expect(agreed).toBe(room.priceMonthly)
  })

  it('a null agreed rent falls back to the room price', async () => {
    const room = await vacantRoom()
    const { invoiceId, tenancyId } = await approveApplication((await newStudent()).id, room.id, { durationMonths: 2 })
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { agreedMonthlyRent: null } })
    await callerFor(await ownerOf(room)).payment.recordManual(await cash(room.kosId, invoiceId))
    const later = await prisma.invoice.findMany({ where: { tenancyId, id: { not: invoiceId } } })
    expect(later.map((i) => i.amount)).toEqual([room.priceMonthly])
  })
})

describe('[A-012] PaymentSummary exposes the refund reason and a stale PENDING reads as EXPIRED', () => {
  const base = { id: 'p1', provider: 'XENDIT' as const, checkoutUrl: 'https://pay.example/x', paidAt: null, receiptNo: 1 }
  const now = new Date('2026-11-19T05:00:00Z')
  it('refundReason comes from the refund row; null when none', () => {
    expect(toPaymentSummary({ ...base, status: 'REFUND_PENDING', expiresAt: null, refund: { reason: 'INVOICE_ALREADY_PAID' } }, now).refundReason).toBe('INVOICE_ALREADY_PAID')
    expect(toPaymentSummary({ ...base, status: 'PAID', expiresAt: null }, now).refundReason).toBeNull()
  })
  it('PENDING at or past expiresAt is reported EXPIRED with no checkout URL; before it stays PENDING', () => {
    for (const at of ['2026-11-19T04:59:59Z', now.toISOString()]) {
      const s = toPaymentSummary({ ...base, status: 'PENDING', expiresAt: new Date(at) }, now)
      expect([s.status, s.checkoutUrl]).toEqual(['EXPIRED', null])
    }
    expect(toPaymentSummary({ ...base, status: 'PENDING', expiresAt: new Date('2026-11-19T05:00:01Z') }, now).status).toBe('PENDING')
  })
})

describe('[A-015] a PENDING hold is expired at exactly expiresAt on both read and payment paths', () => {
  it('payment.start rejects and the board reads vacant at the same instant', async () => {
    const room = await vacantRoom()
    const student = await newStudent()
    const { invoiceId, tenancyId } = await approveApplication(student.id, room.id)
    const at = new Date(Date.now() + 3_600_000)
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { expiresAt: at } })
    expect(await code(startPaymentAttempt(prisma, new MockPaymentProvider(), student.id, invoiceId, at))).toBe('CONFLICT')
    expect((await boardRoom(room.id, room.kosId, at)).status).toBe('vacant')
    expect((await boardRoom(room.id, room.kosId, new Date(at.getTime() - 1))).status).toBe('booking')
  })
})

describe('[B-08] Rp 0 is rejected', () => {
  it('recordManual refuses confirmedAmount 0', async () => {
    const room = await vacantRoom()
    const { invoiceId } = await approveApplication((await newStudent()).id, room.id)
    expect(await code(callerFor(await ownerOf(room)).payment.recordManual(await cash(room.kosId, invoiceId, { confirmedAmount: 0 })))).toBe('BAD_REQUEST')
  })
})

describe('stale CREATING attempts and due/overdue board labels', () => {
  it('treats a CREATING row older than 2 minutes as FAILED/not live even when expiresAt is still ahead', async () => {
    const now = new Date('2026-11-19T05:05:00Z')
    const base = { id: 'p1', provider: 'XENDIT' as const, status: 'CREATING' as const, checkoutUrl: null, expiresAt: new Date('2026-11-19T05:30:00Z'), paidAt: null, receiptNo: 1 }
    const stale = { ...base, createdAt: new Date('2026-11-19T05:02:59Z') }
    const fresh = { ...base, createdAt: new Date('2026-11-19T05:04:00Z') }
    expect(isLiveAttempt(stale, now)).toBe(false)
    expect(toPaymentSummary(stale, now).status).toBe('FAILED')
    expect(isLiveAttempt(fresh, now)).toBe(true)
    expect(toPaymentSummary(fresh, now).status).toBe('CREATING')

    const room = await vacantRoom()
    const { invoiceId } = await approveApplication((await newStudent()).id, room.id)
    const p = await prisma.payment.create({
      data: { invoiceId, provider: 'XENDIT', status: 'CREATING', amount: 1000, expiresAt: new Date(Date.now() + 25 * 60_000), createdAt: new Date(Date.now() - 3 * 60_000) },
    })
    expect((await boardRoom(room.id, room.kosId)).payment).toBeNull()
    await prisma.payment.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - 30_000) } })
    expect((await boardRoom(room.id, room.kosId)).payment?.state).toBe('AWAITING_ONLINE')
  })

  it('does not show VERIFIED or MANUAL on the owner board once the next invoice is due or overdue', async () => {
    const room = await vacantRoom()
    const { invoiceId, tenancyId, invoice } = await approveApplication((await newStudent()).id, room.id, { durationMonths: 2 })
    const p = await prisma.payment.create({
      data: { invoiceId, provider: 'XENDIT', status: 'PENDING', amount: invoice.amount, providerSessionId: `ps_${invoiceId}`, providerBusinessId: TEST_BUSINESS_ID },
    })
    await applyPaymentEventTx(prisma, { provider: 'XENDIT', expectedBusinessId: TEST_BUSINESS_ID }, {
      kind: 'SESSION_COMPLETED', referenceId: p.id, providerBusinessId: TEST_BUSINESS_ID, amount: invoice.amount, currency: 'IDR', occurredAt: new Date(),
      providerSessionId: p.providerSessionId!, providerPaymentRequestId: 'pr_m1', providerPaymentId: 'py_m1',
    })
    expect((await boardRoom(room.id, room.kosId)).payment?.state).toBe('VERIFIED')

    const month2 = await prisma.invoice.findFirstOrThrow({ where: { tenancyId, status: 'UNPAID' } })
    const overdueNow = new Date(month2.dueDate.getTime() + 5 * 86_400_000)
    const overdueRow = await boardRoom(room.id, room.kosId, overdueNow)
    expect(overdueRow.status).toBe('overdue')
    expect(overdueRow.payment).toBeNull()

    const dueNow = new Date(month2.dueDate.getTime() - 2 * 86_400_000)
    const dueRow = await boardRoom(room.id, room.kosId, dueNow)
    expect(dueRow.status).toBe('due')
    expect(dueRow.payment).toBeNull()
  })
})
