import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { approveApplication, callerFor, cash, lapseAttempts, newStudent, postXenditWebhook, prisma, sessionWebhook, TEST_BUSINESS_ID, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null

async function fixture() {
  const student = await newStudent()
  const room = await vacantRoom()
  const approved = await approveApplication(student.id, room.id)
  const ownerId = (await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: room.kosId } } } })).userId
  return { student, ownerId, ...approved }
}

const liveAttempt = (invoiceId: string, provider: 'XENDIT' | 'MOCK', status: 'CREATING' | 'PENDING', expiresAt: Date | null) =>
  prisma.payment.create({
    data: { invoiceId, provider, status, amount: 1, expiresAt, providerBusinessId: provider === 'MOCK' ? 'kobo-mock' : TEST_BUSINESS_ID },
  })

describe('payment.recordManual (audited)', () => {
  it('persists method, reference, note and the recording owner, and shows method and reference but never the note on the receipt', async () => {
    const { room, ownerId, invoiceId, student } = await fixture()
    const owner = callerFor(ownerId)
    const out = await owner.payment.recordManual(await cash(room.kosId, invoiceId, { method: 'BANK_TRANSFER', reference: 'TRF-123/AB', note: 'private note' }))
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: out.paymentId } })).toMatchObject({
      provider: 'MANUAL',
      status: 'PAID',
      manualMethod: 'BANK_TRANSFER',
      manualReference: 'TRF-123/AB',
      manualNote: 'private note',
      recordedById: ownerId,
    })
    for (const viewer of [owner, callerFor(student.id)]) {
      const k = await viewer.kuitansi.get({ receiptNo: out.receiptNumber })
      expect(k.manual).toEqual({ method: 'BANK_TRANSFER', reference: 'TRF-123/AB' })
      expect(JSON.stringify(k)).not.toContain('private note')
    }
  })

  it('rejects a wrong amount, a missing transfer reference, a reference on cash, and an over-long note', async () => {
    const { room, ownerId, invoiceId } = await fixture()
    const owner = callerFor(ownerId)
    expect((await err(owner.payment.recordManual(await cash(room.kosId, invoiceId, { confirmedAmount: 1 }))))?.code).toBe('BAD_REQUEST')
    expect((await err(owner.payment.recordManual(await cash(room.kosId, invoiceId, { method: 'BANK_TRANSFER' }))))?.code).toBe('BAD_REQUEST')
    expect((await err(owner.payment.recordManual(await cash(room.kosId, invoiceId, { reference: 'ABC123' }))))?.code).toBe('BAD_REQUEST')
    expect((await err(owner.payment.recordManual(await cash(room.kosId, invoiceId, { note: 'x'.repeat(501) }))))?.code).toBe('BAD_REQUEST')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('UNPAID')
    expect(await prisma.payment.count({ where: { invoiceId } })).toBe(0)
  })

  it.each([
    ['XENDIT', 'CREATING', null],
    ['XENDIT', 'PENDING', new Date(Date.now() + 20 * 60_000)],
    ['MOCK', 'PENDING', null],
  ] as const)('refuses while a live %s %s attempt exists and leaves it untouched', async (provider, status, expiresAt) => {
    const { room, ownerId, invoiceId } = await fixture()
    const attempt = await liveAttempt(invoiceId, provider, status, expiresAt)
    expect((await err(callerFor(ownerId).payment.recordManual(await cash(room.kosId, invoiceId))))?.code).toBe('CONFLICT')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe(status)
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('UNPAID')
  })

  it('expires a lapsed attempt and then records the payment', async () => {
    const { room, ownerId, invoiceId } = await fixture()
    const attempt = await liveAttempt(invoiceId, 'XENDIT', 'PENDING', new Date(Date.now() - 1000))
    await callerFor(ownerId).payment.recordManual(await cash(room.kosId, invoiceId))
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe('EXPIRED')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('PAID')
  })

  it('does not revive a lapsed hold or an ended tenancy', async () => {
    const { room, ownerId, invoiceId, tenancyId } = await fixture()
    const owner = callerFor(ownerId)
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await err(owner.payment.recordManual(await cash(room.kosId, invoiceId))))?.code).toBe('CONFLICT')
    await prisma.tenancy.update({ where: { id: tenancyId }, data: { status: 'ENDED' } })
    expect((await err(owner.payment.recordManual(await cash(room.kosId, invoiceId))))?.code).toBe('CONFLICT')
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })).status).toBe('ENDED')
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('UNPAID')
  })

  it('has exactly one winner when a manual payment races the tenancy ending', async () => {
    const { room, ownerId, invoiceId, tenancyId } = await fixture()
    const owner = callerFor(ownerId)
    const [paid, ended] = await Promise.all([
      err(owner.payment.recordManual(await cash(room.kosId, invoiceId))),
      err(owner.owner.tenancy.end({ kosId: room.kosId, tenancyId })),
    ])
    const tenancy = await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } })
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })
    // Either the payment activated the tenancy and then it ended, or the end won and the payment was refused.
    expect(tenancy.status).toBe('ENDED')
    if (paid) expect(invoice.status).toBe('UNPAID')
    if (ended) expect(tenancy.status).not.toBe('ACTIVE')
  })
})

describe('owner.tenancy.end and online attempts', () => {
  it('fails the live attempt with TENANCY_ENDED, and a late payment is queued for refund', async () => {
    const { room, ownerId, invoiceId, tenancyId } = await fixture()
    const pending = await prisma.payment.create({
      data: { invoiceId, provider: 'XENDIT', status: 'PENDING', amount: 0, providerSessionId: 'ps_end', providerBusinessId: TEST_BUSINESS_ID, expiresAt: new Date(Date.now() + 600_000) },
    })
    await prisma.payment.updateMany({ where: { id: pending.id }, data: { amount: (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).amount } })

    await callerFor(ownerId).owner.tenancy.end({ kosId: room.kosId, tenancyId })
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: 'FAILED', failureCode: 'TENANCY_ENDED' })

    const late = await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } })
    expect((await postXenditWebhook(sessionWebhook('completed', late))).status).toBe(200)
    expect(await prisma.paymentRefund.findUniqueOrThrow({ where: { paymentId: pending.id } })).toMatchObject({ reason: 'TENANCY_ENDED', status: 'PENDING' })
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('UNPAID')
  })

  it('keeps lapseAttempts honest: a lapsed MOCK attempt no longer blocks', async () => {
    const { room, ownerId, invoiceId } = await fixture()
    await liveAttempt(invoiceId, 'MOCK', 'PENDING', null)
    await lapseAttempts(invoiceId)
    await callerFor(ownerId).payment.recordManual(await cash(room.kosId, invoiceId))
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe('PAID')
  })
})
