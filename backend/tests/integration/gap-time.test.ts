import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { advanceAllWaitlists } from '../../src/waitlist.ts'
import { approveApplication, caller, callerFor, newStudent, prisma, vacantRoom } from '../helpers.ts'
import { err, joinQueue, makeKos, occupy } from './gap-helpers.ts'

// Only Date is faked: faking timers would hang pg. The procedures read the clock through `new Date()`.
const at = (iso: string) => vi.setSystemTime(new Date(iso))

beforeEach(async () => {
  vi.useRealTimers()
  await resetDb(prisma)
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => vi.useRealTimers())

/** A fresh room (own kos, nothing else on it) so every application in a test is independent. */
async function freshRoom() {
  const k = await makeKos([{ n: 'T1', type: 'Standar' }])
  return { ...k, roomId: k.room('T1').id }
}

describe('[G-021][R-020] application.create startDate around WIB midnight', () => {
  it('accepts today in WIB until 23:59:59 and refuses it from 00:00:00', async () => {
    const msg = 'Tanggal mulai tidak boleh di masa lalu.'
    const apply = async (startDate: string) => {
      const r = await freshRoom()
      const s = await newStudent()
      return err(callerFor(s.id).application.create({ roomId: r.roomId, startDate, durationMonths: 3, occupation: 'Mahasiswa' }))
    }

    at('2026-11-10T16:59:59.000Z') // 23:59:59 WIB on 10 Nov
    expect(await apply('2026-11-10')).toBeNull()
    const yesterday = await apply('2026-11-09')
    expect([yesterday?.code, yesterday?.message]).toEqual(['BAD_REQUEST', msg])

    at('2026-11-10T17:00:00.000Z') // 00:00:00 WIB on 11 Nov
    const stale = await apply('2026-11-10')
    expect([stale?.code, stale?.message]).toEqual(['BAD_REQUEST', msg])
    expect(await apply('2026-11-11')).toBeNull()
  })
})

describe('[G-022][R-051] visit.create is strictly after today in WIB', () => {
  it('moves the cut-off exactly at WIB midnight', async () => {
    const k = await makeKos([{ n: 'V1', type: 'Standar' }])
    const book = async (date: string) => {
      const s = await newStudent()
      return err(callerFor(s.id).visit.create({ kosId: k.kos.id, date, timeSlot: 'PAGI' }))
    }

    at('2026-11-10T16:59:59.000Z') // still 10 Nov in WIB
    expect(await book('2026-11-10')).not.toBeNull()
    expect(await book('2026-11-11')).toBeNull()

    at('2026-11-10T17:00:00.000Z') // 11 Nov in WIB
    const today = await book('2026-11-11')
    expect([today?.code, today?.message]).toEqual(['BAD_REQUEST', 'Tanggal survey harus setelah hari ini.'])
    expect(await book('2026-11-12')).toBeNull()
  })
})

describe('[G-023][R-016][R-033] the 24-hour hold, to the millisecond', () => {
  it('sets expiresAt to approval + 24 h and flips booking -> vacant only after that instant', async () => {
    const T = new Date('2026-11-10T03:00:00.000Z')
    const k = await makeKos([{ n: 'H1', type: 'Standar' }])
    const s = await newStudent()
    at(T.toISOString())
    const a = await approveApplication(s.id, k.room('H1').id, { startDate: '2026-11-12' })

    expect(a.tenancy.status).toBe('PENDING')
    expect(a.tenancy.expiresAt!.getTime()).toBe(T.getTime() + 86_400_000)

    const statusAt = async (ms: number) => {
      vi.setSystemTime(new Date(T.getTime() + ms))
      const detail = await caller.kos.detail({ id: k.kos.id })
      return detail.rooms.find((r) => r.roomNumber === 'H1')!.status
    }
    expect(await statusAt(86_400_000 - 1000)).toBe('booking')
    expect(await statusAt(86_400_000)).toBe('booking')
    expect(await statusAt(86_400_000 + 1)).toBe('vacant')
  })
})

describe('[G-024][R-032] overdue flips at 00:00 WIB through owner.board and kos.detail', () => {
  it('is not overdue at 23:59:59 WIB on the due date and overdue one second later', async () => {
    const k = await makeKos([{ n: 'D1', type: 'Standar' }])
    const s = await newStudent()
    const a = await approveApplication(s.id, k.room('D1').id, { startDate: '2026-11-05' })
    await prisma.tenancy.update({ where: { id: a.tenancyId }, data: { status: 'ACTIVE', expiresAt: null } })
    await prisma.invoice.update({ where: { id: a.invoiceId }, data: { dueDate: new Date('2026-11-10T00:00:00Z'), status: 'UNPAID' } })

    const read = async (iso: string) => {
      at(iso)
      const board = await k.owner.board({ kosId: k.kos.id })
      const detail = await caller.kos.detail({ id: k.kos.id })
      return [board.rooms.find((r) => r.roomNumber === 'D1')!.status, detail.rooms.find((r) => r.roomNumber === 'D1')!.status]
    }
    const lastSecond = await read('2026-11-10T16:59:59.000Z')
    expect(lastSecond).not.toContain('overdue')
    expect(await read('2026-11-10T17:00:00.000Z')).toEqual(['overdue', 'overdue'])
  })
})

describe('[G-025][R-041] receipt number uses the WIB month and year', () => {
  it('prints KB/<year>/<month>/<padded no> for instants either side of WIB midnight', async () => {
    const payments = await prisma.payment.findMany({ where: { status: 'PAID', provider: { in: ['MANUAL', 'MOCK'] } }, take: 3, orderBy: { receiptNo: 'asc' }, include: { invoice: { include: { tenancy: true } } } })
    expect(payments.length).toBe(3)
    const cases = [
      { paidAt: '2026-12-31T16:59:59.000Z', prefix: 'KB/2026/12/' },
      { paidAt: '2026-12-31T17:00:00.000Z', prefix: 'KB/2027/01/' },
      { paidAt: '2026-10-31T17:00:00.000Z', prefix: 'KB/2026/11/' },
    ]
    for (const [i, c] of cases.entries()) {
      const p = payments[i]!
      await prisma.payment.update({ where: { id: p.id }, data: { paidAt: new Date(c.paidAt) } })
      const view = await callerFor(p.invoice.tenancy.userId).kuitansi.get({ receiptNo: p.receiptNo })
      expect(view.receiptNo).toBe(`${c.prefix}${String(p.receiptNo).padStart(4, '0')}`)
    }
  })
})

describe('[G-026][R-062][R-064] the 24-hour waitlist offer, to the millisecond', () => {
  it('sets offerExpiresAt to the freeing instant + 24 h; it is live at the deadline and expired 1 ms later', async () => {
    const T = new Date('2026-11-10T03:00:00.000Z')
    const k = await makeKos([{ n: 'S1', type: 'Standar' }])
    const tenancyId = await occupy(k.room('S1').id)
    const first = await joinQueue(k.kos.id)
    // The fake clock does not tick: without this both entries share one createdAt and the FIFO tie-break is a random id.
    vi.setSystemTime(new Date(Date.now() + 1000))
    const second = await joinQueue(k.kos.id)
    at(T.toISOString())
    await k.owner.tenancy.end({ kosId: k.kos.id, tenancyId })

    const entry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: first.entry.id } })
    expect(entry.status).toBe('OFFERED')
    expect(entry.offerExpiresAt!.getTime()).toBe(T.getTime() + 86_400_000)

    // a stranger cannot take the room while the offer is live, even at the deadline itself
    vi.setSystemTime(new Date(T.getTime() + 86_400_000))
    const stranger = await newStudent()
    const live = await err(callerFor(stranger.id).application.create({ roomId: k.room('S1').id, startDate: '2026-11-13', durationMonths: 3, occupation: 'Mahasiswa' }))
    expect(live?.code).toBe('CONFLICT')

    vi.setSystemTime(new Date(T.getTime() + 86_400_000 + 1))
    await advanceAllWaitlists(prisma, new Date())
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: first.entry.id } })).status).toBe('EXPIRED')
    expect(await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: second.entry.id } })).toMatchObject({ status: 'OFFERED', offeredRoomId: k.room('S1').id })
  })
})

void vacantRoom
