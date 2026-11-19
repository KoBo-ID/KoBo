import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import type { NormalizedPaymentEvent } from '../../src/payment/provider.ts'
import { applyPaymentEventTx } from '../../src/payment/settlement.ts'
import { advanceAllWaitlists, lockKos } from '../../src/waitlist.ts'
import { approveApplication, callerFor, newStudent, prisma, vacantRoom } from '../helpers.ts'

/*
 * A-001: Kos FOR UPDATE is the outermost lock. Every probe holds the Kos row in one transaction, starts the operation
 * under test in parallel, then checks (SKIP LOCKED, so nothing blocks or aborts) that the operation has NOT yet taken
 * the Invoice / Tenancy / WaitlistEntry row it will need. Before the fix those rows were locked first, and the Kos
 * lock came second: the inverted order that deadlocks against advanceWaitlist.
 */
beforeEach(() => resetDb(prisma))

const startDate = () => addDays(todayWIB(new Date()), 3)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Table = 'Invoice' | 'Tenancy' | 'WaitlistEntry'
/** Runs `op` while another transaction holds the kos; returns which of the given rows `op` had already locked. */
async function lockedMeanwhile(kosId: string, op: () => Promise<unknown>, probes: { table: Table; id: string }[], during?: () => Promise<void>): Promise<Table[]> {
  let running: Promise<unknown> | undefined
  const held: Table[] = []
  await prisma.$transaction(
    async (tx) => {
      await lockKos(tx, kosId)
      running = op()
      running.catch(() => undefined)
      await sleep(600)
      await during?.()
      for (const p of probes) {
        const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${p.table}" WHERE id = $1 FOR UPDATE SKIP LOCKED`, p.id)
        if (rows.length === 0) held.push(p.table)
      }
    },
    { timeout: 15_000 },
  )
  await running
  return held
}

async function offeredFixture() {
  const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { user: { isDemo: false } }, orderBy: { id: 'asc' } })
  const kos = await prisma.kos.create({
    data: {
      slug: 'lock-order',
      name: 'Kos Lock Order',
      gender: 'CAMPUR',
      address: 'Jl. Lock',
      district: 'Kebayoran',
      city: 'Jakarta',
      lat: -6.2,
      lng: 106.8,
      electricityType: 'INCLUDED',
      ownerId: owner.id,
      rooms: { create: [{ roomNumber: 'L1', floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 1_500_000 }] },
    },
    include: { rooms: true },
  })
  const room = kos.rooms[0]
  const tenant = await newStudent()
  const tenancy = await prisma.tenancy.create({ data: { roomId: room.id, userId: tenant.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 } })
  const waiter = await newStudent()
  const entry = await prisma.waitlistEntry.create({ data: { kosId: kos.id, userId: waiter.id } })
  return { kos, room, tenancy, waiter, entry, ownerUserId: owner.userId }
}

describe('A-001 lock order: Kos first', () => {
  it('waitlist.leave / decline / owner.waitlist.remove do not touch the entry before the kos lock', async () => {
    for (const how of ['leave', 'decline', 'remove'] as const) {
      await resetDb(prisma)
      const f = await offeredFixture()
      await prisma.waitlistEntry.update({ where: { id: f.entry.id }, data: { status: 'OFFERED', offeredRoomId: f.room.id, offerExpiresAt: new Date(Date.now() + 3600_000) } })
      const c = callerFor(f.waiter.id)
      const op =
        how === 'leave'
          ? () => c.waitlist.leave({ entryId: f.entry.id })
          : how === 'decline'
            ? () => c.waitlist.decline({ entryId: f.entry.id })
            : () => callerFor(f.ownerUserId).owner.waitlist.remove({ kosId: f.kos.id, entryId: f.entry.id })
      expect(await lockedMeanwhile(f.kos.id, op, [{ table: 'WaitlistEntry', id: f.entry.id }]), how).toEqual([])
      expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: f.entry.id } })).status).toBe(how === 'leave' ? 'LEFT' : how === 'decline' ? 'DECLINED' : 'REMOVED')
    }
  })

  it('owner.tenancy.end takes the kos lock before the invoice and tenancy rows', async () => {
    const f = await offeredFixture()
    const inv = await prisma.invoice.create({
      data: { tenancyId: f.tenancy.id, periodStart: new Date(), dueDate: new Date(), amount: 100, rentAmount: 100, discountAmount: 0, applicationFeeAmount: 0, ownerReceivableAmount: 100, gatewayFeeBearer: 'PLATFORM', status: 'UNPAID' },
    })
    const op = () => callerFor(f.ownerUserId).owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancy.id })
    const held = await lockedMeanwhile(f.kos.id, op, [{ table: 'Invoice', id: inv.id }, { table: 'Tenancy', id: f.tenancy.id }])
    expect(held).toEqual([])
    expect((await prisma.tenancy.findUniqueOrThrow({ where: { id: f.tenancy.id } })).status).toBe('ENDED')
  })

  it('settlement takes the kos lock before the invoice row', async () => {
    const student = await newStudent()
    const room = await vacantRoom()
    const approved = await approveApplication(student.id, room.id, { startDate: startDate(), durationMonths: 3 })
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: approved.invoiceId } })
    const p = await prisma.payment.create({
      data: { invoiceId: invoice.id, provider: 'XENDIT', status: 'PENDING', amount: invoice.amount, providerSessionId: 'ps_lock', providerBusinessId: 'biz_lock', expiresAt: new Date(Date.now() + 20 * 60_000) },
    })
    const event: NormalizedPaymentEvent = {
      kind: 'SESSION_COMPLETED',
      referenceId: p.id,
      providerBusinessId: 'biz_lock',
      amount: p.amount,
      currency: 'IDR',
      occurredAt: new Date(),
      providerSessionId: 'ps_lock',
      providerPaymentRequestId: 'pr_lock',
      providerPaymentId: 'pay_lock',
    }
    const op = () => applyPaymentEventTx(prisma, { provider: 'XENDIT', expectedBusinessId: 'biz_lock' }, event)
    // A settlement that is blocked on the kos has not paid anything yet (before the fix it finished while the kos was held).
    const held = await lockedMeanwhile(room.kosId, op, [{ table: 'Invoice', id: invoice.id }], async () => {
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('UNPAID')
    })
    expect(held).toEqual([])
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('PAID')
  })

  it('settlement racing a waitlist tick on a lapsed hold never deadlocks and never double-claims the room', async () => {
    for (let i = 0; i < 4; i++) {
      await resetDb(prisma)
      const student = await newStudent()
      const room = await vacantRoom()
      const approved = await approveApplication(student.id, room.id, { startDate: startDate(), durationMonths: 3 })
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: approved.invoiceId } })
      // The hold lapsed a second ago but the payment completed before it did, with a waiter queued behind.
      await prisma.tenancy.update({ where: { id: approved.tenancyId }, data: { expiresAt: new Date(Date.now() - 1000) } })
      const waiter = await newStudent()
      await prisma.waitlistEntry.create({ data: { kosId: room.kosId, userId: waiter.id } })
      const p = await prisma.payment.create({
        data: { invoiceId: invoice.id, provider: 'XENDIT', status: 'PENDING', amount: invoice.amount, providerSessionId: 'ps_r', providerBusinessId: 'biz_r', expiresAt: new Date(Date.now() + 20 * 60_000) },
      })
      const event: NormalizedPaymentEvent = {
        kind: 'SESSION_COMPLETED',
        referenceId: p.id,
        providerBusinessId: 'biz_r',
        amount: p.amount,
        currency: 'IDR',
        occurredAt: new Date(Date.now() - 2000),
        providerSessionId: 'ps_r',
        providerPaymentRequestId: 'pr_r',
        providerPaymentId: 'pay_r',
      }
      const res = await Promise.allSettled([
        applyPaymentEventTx(prisma, { provider: 'XENDIT', expectedBusinessId: 'biz_r' }, event),
        advanceAllWaitlists(prisma),
        callerFor(waiter.id).waitlist.leave({ entryId: (await prisma.waitlistEntry.findFirstOrThrow({ where: { userId: waiter.id } })).id }),
      ])
      expect(res.filter((r) => r.status === 'rejected' && /deadlock|40P01/i.test(String((r as PromiseRejectedResult).reason))).map((r) => String((r as PromiseRejectedResult).reason))).toEqual([])
      // Whatever interleaving won, the room has at most one live claimant.
      const live = await prisma.tenancy.count({ where: { roomId: room.id, status: 'ACTIVE' } })
      const offered = await prisma.waitlistEntry.count({ where: { kosId: room.kosId, status: 'OFFERED', offeredRoomId: room.id } })
      expect(live + offered).toBeLessThanOrEqual(1)
    }
  })
})
