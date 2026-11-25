import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { applyPaymentEventTx } from '../../src/payment/settlement.ts'
import { startPaymentAttempt } from '../../src/payment/attempts.ts'
import { MockPaymentProvider } from '../../src/payment/mock.ts'
import { approveApplication, callerFor, cash, newStudent, prisma, TEST_BUSINESS_ID } from '../helpers.ts'
import { makeKos } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))
afterEach(() => {
  vi.useRealTimers()
})

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null

/**
 * Builds an ACTIVE 3-month lease (month 1 PAID, months 2 & 3 UNPAID) with deterministic dates around `today`.
 * `month2Due` defaults to 5 days ago (past-due arrear); `month3Due` defaults to 25 days ahead (future).
 */
async function activeLeaseWithMonths(opts: { month2Due?: string; month3Due?: string; now?: Date; rent?: number } = {}) {
  const now = opts.now ?? new Date()
  const today = todayWIB(now)
  const rent = opts.rent ?? 1_800_000
  const k = await makeKos([{ n: '101', type: 'Standar', price: rent }], { applicationFee: 25_000, studentDiscountAmount: 0 })
  const ownerCaller = callerFor(k.ownerUserId)
  const room = k.room('101')
  const student = await newStudent()
  const approved = await approveApplication(student.id, room.id, { startDate: addDays(today, 2), durationMonths: 3 })
  // Activate via manual payment on invoice #1.
  const firstPaid = await ownerCaller.payment.recordManual(await cash(k.kos.id, approved.invoiceId))
  const invoices = await prisma.invoice.findMany({ where: { tenancyId: approved.tenancyId }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }] })
  expect(invoices).toHaveLength(3)
  const m1 = invoices[0]!
  const m2 = invoices[1]!
  const m3 = invoices[2]!
  // Pin month 1 in the past so ordering stays month 1 -> month 2 -> month 3.
  const m1Due = addDays(today, -35)
  const m2Due = opts.month2Due ?? addDays(today, -5)
  const m3Due = opts.month3Due ?? addDays(today, 25)
  await prisma.invoice.update({ where: { id: m1.id }, data: { periodStart: new Date(`${m1Due}T00:00:00Z`), dueDate: new Date(`${m1Due}T00:00:00Z`) } })
  await prisma.invoice.update({ where: { id: m2.id }, data: { periodStart: new Date(`${m2Due}T00:00:00Z`), dueDate: new Date(`${m2Due}T00:00:00Z`) } })
  await prisma.invoice.update({ where: { id: m3.id }, data: { periodStart: new Date(`${m3Due}T00:00:00Z`), dueDate: new Date(`${m3Due}T00:00:00Z`) } })
  return { k, ownerCaller, room, student, tenancyId: approved.tenancyId, firstPaid, m1, m2, m3, rent }
}

describe('[SIM-001] owner.tenancy.endPreview', () => {
  it('separates arrears (dueDate <= todayWIB) from future unpaid months, respecting the WIB date boundary', async () => {
    // 2026-11-25 17:30 UTC is already 2026-11-26 00:30 WIB.
    const wibMidnightPlus = new Date('2026-11-25T17:30:00Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(wibMidnightPlus)
    expect(todayWIB(new Date())).toBe('2026-11-26')

    const { k, ownerCaller, tenancyId, m2 } = await activeLeaseWithMonths({
      now: wibMidnightPlus,
      month2Due: '2026-11-26', // equal to todayWIB -> arrear!
      month3Due: '2026-11-27', // strictly after todayWIB -> future unpaid!
    })
    const preview = await ownerCaller.owner.tenancy.endPreview({ kosId: k.kos.id, tenancyId })
    expect(preview).toEqual({
      arrears: [{ invoiceId: m2.id, periodStart: '2026-11-26', dueDate: '2026-11-26', amount: 1_800_000 }],
      arrearsTotal: 1_800_000,
      futureUnpaidCount: 1,
    })

    // One hour earlier (2026-11-25 16:30 UTC = 2026-11-25 23:30 WIB): 2026-11-26 is still in the future!
    vi.setSystemTime(new Date('2026-11-25T16:30:00Z'))
    expect(todayWIB(new Date())).toBe('2026-11-25')
    const previewBeforeMidnight = await ownerCaller.owner.tenancy.endPreview({ kosId: k.kos.id, tenancyId })
    expect(previewBeforeMidnight).toEqual({
      arrears: [],
      arrearsTotal: 0,
      futureUnpaidCount: 2,
    })
  })
})

describe('[SIM-001] owner.tenancy.end, board formerTenantArrears, MyKos billingState, and post-end manual pay', () => {
  it('ends as before when there are no arrears; future months are NOT_BILLED and PAID history stays untouched', async () => {
    const today = todayWIB(new Date())
    const { k, ownerCaller, tenancyId, student, firstPaid, m1, m2, m3 } = await activeLeaseWithMonths({
      month2Due: addDays(today, 10),
      month3Due: addDays(today, 40),
    })

    await ownerCaller.owner.tenancy.end({ kosId: k.kos.id, tenancyId })

    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ENDED')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: m1.id } })).status).toBe('PAID')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: m2.id } })).status).toBe('UNPAID')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: m3.id } })).status).toBe('UNPAID')

    const board = await ownerCaller.owner.board({ kosId: k.kos.id })
    expect(board.summary.overdueAmount).toBe(0)
    expect(board.summary.formerTenantArrears).toEqual([])
    expect(board.summary.formerTenantArrearsTotal).toBe(0)

    const mine = (await callerFor(student.id).booking.mine()).find((t) => t.id === tenancyId)!
    expect(mine.invoices.map((i) => i.billingState)).toEqual(['PAID', 'NOT_BILLED', 'NOT_BILLED'])
    expect(mine.invoices.every((i) => !i.canPay)).toBe(true)

    // Paid Kuitansi still works; manual pay on future unbilled month is refused.
    expect((await callerFor(student.id).kuitansi.get({ receiptNo: firstPaid.receiptNumber })).status).toBe('PAID')
    expect((await err(ownerCaller.payment.recordManual(await cash(k.kos.id, m2.id))))?.code).toBe('CONFLICT')
  })

  it('refuses ending with arrears when arrears choice is missing (CONFLICT naming the total) and leaves tenancy ACTIVE', async () => {
    const { k, ownerCaller, tenancyId, m2 } = await activeLeaseWithMonths()
    const e = await err(ownerCaller.owner.tenancy.end({ kosId: k.kos.id, tenancyId }))
    expect(e?.code).toBe('CONFLICT')
    expect(e?.message).toContain('1.800.000')
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ACTIVE')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: m2.id } })).status).toBe('UNPAID')
  })

  it('KEEP: leaves past-due invoice UNPAID, lists it in formerTenantArrears (separate from overdueAmount), exposes OVERDUE in MyKos, and accepts manual payment afterwards', async () => {
    const { k, ownerCaller, tenancyId, student, firstPaid, m1, m2, m3 } = await activeLeaseWithMonths()
    const m2Due = (await prisma.invoice.findUniqueOrThrow({ where: { id: m2.id } })).dueDate.toISOString().slice(0, 10)

    await ownerCaller.owner.tenancy.end({ kosId: k.kos.id, tenancyId, arrears: 'KEEP' })

    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ENDED')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: m1.id } })).status).toBe('PAID')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: m2.id } })).status).toBe('UNPAID')

    const board = await ownerCaller.owner.board({ kosId: k.kos.id })
    expect(board.summary.overdueAmount).toBe(0) // ACTIVE tenancies only!
    expect(board.summary.formerTenantArrearsTotal).toBe(1_800_000)
    expect(board.summary.formerTenantArrears).toEqual([
      {
        tenancyId,
        roomNumber: '101',
        tenantName: student.name,
        amount: 1_800_000,
        oldestDueDate: m2Due,
        invoices: [{ invoiceId: m2.id, periodStart: m2Due, dueDate: m2Due, amount: 1_800_000 }],
      },
    ])

    // Student sees OVERDUE on past-due month 2, NOT_BILLED on future month 3, PAID on month 1; online payment disabled.
    const mine = (await callerFor(student.id).booking.mine()).find((t) => t.id === tenancyId)!
    expect(mine.invoices.map((i) => i.billingState)).toEqual(['PAID', 'OVERDUE', 'NOT_BILLED'])
    expect(mine.invoices[1]!.canPay).toBe(false)
    expect((await err(startPaymentAttempt(prisma, new MockPaymentProvider(), student.id, m2.id)))?.code).toBe('CONFLICT')

    // Future month 3 cannot be marked paid manually, but past-due month 2 CAN.
    expect((await err(ownerCaller.payment.recordManual(await cash(k.kos.id, m3.id))))?.code).toBe('CONFLICT')
    const paidArrear = await ownerCaller.payment.recordManual(await cash(k.kos.id, m2.id, { method: 'BANK_TRANSFER', reference: 'TRF-ARREAR-1' }))
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: m2.id } })).status).toBe('PAID')
    // Tenancy stays ENDED (never revived!).
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ENDED')

    // Board formerTenantArrears clears; both receipts work; PAID month 1 untouched.
    const boardAfter = await ownerCaller.owner.board({ kosId: k.kos.id })
    expect(boardAfter.summary.formerTenantArrears).toEqual([])
    expect(boardAfter.summary.formerTenantArrearsTotal).toBe(0)
    expect((await callerFor(student.id).kuitansi.get({ receiptNo: paidArrear.receiptNumber })).status).toBe('PAID')
    expect((await callerFor(student.id).kuitansi.get({ receiptNo: firstPaid.receiptNumber })).status).toBe('PAID')
  })

  it('WAIVE: requires a 5-200 char reason, marks arrears WAIVED with audit fields, excludes from all totals, blocks Kuitansi & payments, keeps PAID history', async () => {
    const { k, ownerCaller, tenancyId, student, firstPaid, m1, m2, m3 } = await activeLeaseWithMonths()

    // Missing or too-short reason rejected with BAD_REQUEST.
    expect((await err(ownerCaller.owner.tenancy.end({ kosId: k.kos.id, tenancyId, arrears: 'WAIVE' })))?.code).toBe('BAD_REQUEST')
    expect((await err(ownerCaller.owner.tenancy.end({ kosId: k.kos.id, tenancyId, arrears: 'WAIVE', waiverReason: '  abc  ' })))?.code).toBe('BAD_REQUEST')
    expect((await err(ownerCaller.owner.tenancy.end({ kosId: k.kos.id, tenancyId, arrears: 'WAIVE', waiverReason: 'x'.repeat(201) })))?.code).toBe('BAD_REQUEST')

    const reason = 'Penyewa sudah pindah mendadak dan pemilik setuju menghapus tunggakan.'
    await ownerCaller.owner.tenancy.end({ kosId: k.kos.id, tenancyId, arrears: 'WAIVE', waiverReason: `  ${reason}  ` })

    const waivedInv = await prisma.invoice.findUniqueOrThrow({ where: { id: m2.id } })
    expect(waivedInv.status).toBe('WAIVED')
    expect(waivedInv.waivedAt).toBeInstanceOf(Date)
    expect(waivedInv.waivedById).toBe(k.ownerUserId)
    expect(waivedInv.waiverReason).toBe(reason)

    // PAID month 1 and future UNPAID month 3 unchanged.
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: m1.id } })).status).toBe('PAID')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: m3.id } })).status).toBe('UNPAID')

    // Excluded from every board total.
    const board = await ownerCaller.owner.board({ kosId: k.kos.id })
    expect(board.summary.overdueAmount).toBe(0)
    expect(board.summary.formerTenantArrears).toEqual([])
    expect(board.summary.formerTenantArrearsTotal).toBe(0)
    expect(board.summary.collectedThisMonth).toBe(0)

    // Student sees WAIVED with waiverReason and cannot pay; future month is NOT_BILLED.
    const mine = (await callerFor(student.id).booking.mine()).find((t) => t.id === tenancyId)!
    expect(mine.invoices.map((i) => i.billingState)).toEqual(['PAID', 'WAIVED', 'NOT_BILLED'])
    expect(mine.invoices[1]).toMatchObject({ status: 'WAIVED', waiverReason: reason, canPay: false, receiptNo: null, receiptNumber: null })

    // Manual payment and online payment start both reject WAIVED invoice; paid invoice also rejected.
    expect((await err(ownerCaller.payment.recordManual(await cash(k.kos.id, m2.id))))?.code).toBe('CONFLICT')
    expect((await err(ownerCaller.payment.recordManual(await cash(k.kos.id, m1.id))))?.code).toBe('CONFLICT')
    expect((await err(startPaymentAttempt(prisma, new MockPaymentProvider(), student.id, m2.id)))?.code).toBe('CONFLICT')

    // Even if a stray late payment arrives on a WAIVED invoice, it refunds (INVOICE_WAIVED) and never produces a Kuitansi.
    const stray = await prisma.payment.create({
      data: { invoiceId: m2.id, provider: 'XENDIT', status: 'PENDING', amount: m2.amount, providerSessionId: 'ps_waived', providerBusinessId: TEST_BUSINESS_ID },
    })
    const settled = await applyPaymentEventTx(prisma, { provider: 'XENDIT', expectedBusinessId: TEST_BUSINESS_ID }, {
      kind: 'SESSION_COMPLETED', referenceId: stray.id, providerBusinessId: TEST_BUSINESS_ID, amount: m2.amount, currency: 'IDR', occurredAt: new Date(),
      providerSessionId: 'ps_waived', providerPaymentRequestId: 'pr_waived', providerPaymentId: 'py_waived',
    })
    expect(settled).toMatchObject({ outcome: 'REFUND_QUEUED', reason: 'INVOICE_WAIVED' })
    expect((await err(callerFor(student.id).kuitansi.get({ receiptNo: stray.receiptNo })))?.code).toBe('NOT_FOUND')
    // Month 1 Kuitansi remains untouched.
    expect((await callerFor(student.id).kuitansi.get({ receiptNo: firstPaid.receiptNumber })).status).toBe('PAID')
  })
})
