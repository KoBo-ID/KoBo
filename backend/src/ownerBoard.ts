import { addMonths, daysOverdue, deriveRoomStatus, formatReceiptNo, todayWIB } from '@kobo/shared/domain'
import type { RoomStatus } from '@kobo/shared/types'
import type { PrismaClient } from './db/client.ts'

/*
 * The owner's view of rooms (spec sections 3 and 4): status is derived on read from today's date, the live
 * tenancy and its oldest unpaid invoice. Nothing here is stored.
 */

export interface BoardRoom {
  id: string
  roomNumber: string
  floor: number
  type: string
  size: string
  bedType: string
  priceMonthly: number
  status: RoomStatus
  /** The live (ACTIVE or unexpired PENDING) tenancy; null when the room reads vacant. */
  tenancyId: string | null
  tenant: { name: string; phone: string | null; campus: string | null } | null
  /** The oldest unpaid invoice of that tenancy. `dueDate` is YYYY-MM-DD (WIB calendar day). */
  invoice: { id: string; dueDate: string; amount: number } | null
  /** Whole days past due; 0 when not overdue. */
  daysOverdue: number
  /** The newest paid receipt of that tenancy, for the kuitansi link. */
  lastReceipt: { receiptNumber: number; receiptNo: string } | null
}

export interface BoardSummary {
  counts: Record<RoomStatus, number>
  totalRooms: number
  /** Rooms that are not vacant (paid, due, overdue, booking). */
  occupiedRooms: number
  /** Rent due this WIB month on active tenancies plus anything already paid. */
  expectedThisMonth: number
  collectedThisMonth: number
  /** Unpaid invoices of active tenancies already past their due date. */
  overdueAmount: number
  /** Live daftar tunggu entries (WAITING or OFFERED). */
  waitlistCount: number
}

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

/** Board rooms for several kos at once, keyed by kos id. */
export async function loadBoardRooms(prisma: PrismaClient, kosIds: string[], now = new Date()): Promise<Map<string, BoardRoom[]>> {
  const rooms = await prisma.room.findMany({
    where: { kosId: { in: kosIds } },
    orderBy: [{ floor: 'asc' }, { roomNumber: 'asc' }],
    include: {
      tenancies: {
        where: { status: { in: ['ACTIVE', 'PENDING'] } },
        include: {
          user: { select: { name: true, phone: true, campus: true } },
          invoices: { orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], include: { payments: { where: { status: 'PAID' }, orderBy: { paidAt: 'desc' } } } },
        },
      },
    },
  })
  const out = new Map<string, BoardRoom[]>(kosIds.map((id) => [id, []]))
  for (const r of rooms) {
    // The partial unique index allows at most one ACTIVE/PENDING tenancy per room.
    const t = r.tenancies[0] ?? null
    const status = deriveRoomStatus({
      occupancy: r.occupancy,
      tenancy: t ? { status: t.status, expiresAt: t.expiresAt?.toISOString() ?? null } : null,
      oldestUnpaidInvoice: t?.invoices.find((i) => i.status === 'UNPAID') ? { dueDate: dateOnly(t.invoices.find((i) => i.status === 'UNPAID')!.dueDate) } : null,
      now,
    })
    const live = t && status !== 'vacant' ? t : null
    const unpaid = live?.invoices.find((i) => i.status === 'UNPAID') ?? null
    const receipts = live ? live.invoices.flatMap((i) => i.payments).filter((p) => p.paidAt) : []
    receipts.sort((a, b) => b.paidAt!.getTime() - a.paidAt!.getTime())
    const last = receipts[0]
    out.get(r.kosId)!.push({
      id: r.id,
      roomNumber: r.roomNumber,
      floor: r.floor,
      type: r.type,
      size: r.size,
      bedType: r.bedType,
      priceMonthly: r.priceMonthly,
      status,
      tenancyId: live?.id ?? null,
      tenant: live ? { name: live.user.name, phone: live.user.phone, campus: live.user.campus } : null,
      invoice: unpaid ? { id: unpaid.id, dueDate: dateOnly(unpaid.dueDate), amount: unpaid.amount } : null,
      daysOverdue: unpaid ? daysOverdue(dateOnly(unpaid.dueDate), now) : 0,
      lastReceipt: last ? { receiptNumber: last.receiptNo, receiptNo: formatReceiptNo(last.receiptNo, last.paidAt!) } : null,
    })
  }
  return out
}

export async function loadBoardSummary(prisma: PrismaClient, kosId: string, rooms: BoardRoom[], now = new Date()): Promise<BoardSummary> {
  const today = todayWIB(now)
  const monthStart = `${today.slice(0, 7)}-01`
  const monthEnd = addMonths(monthStart, 1)
  const [month, overdue, waitlistCount] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        dueDate: { gte: new Date(`${monthStart}T00:00:00Z`), lt: new Date(`${monthEnd}T00:00:00Z`) },
        tenancy: { room: { kosId } },
        OR: [{ status: 'PAID' }, { tenancy: { status: 'ACTIVE' } }],
      },
      select: { amount: true, status: true },
    }),
    prisma.invoice.aggregate({
      _sum: { amount: true },
      where: { status: 'UNPAID', dueDate: { lt: new Date(`${today}T00:00:00Z`) }, tenancy: { status: 'ACTIVE', room: { kosId } } },
    }),
    prisma.waitlistEntry.count({ where: { kosId, status: { in: ['WAITING', 'OFFERED'] } } }),
  ])
  const counts: Record<RoomStatus, number> = { paid: 0, due: 0, overdue: 0, vacant: 0, booking: 0 }
  for (const r of rooms) counts[r.status]++
  return {
    counts,
    totalRooms: rooms.length,
    occupiedRooms: rooms.length - counts.vacant,
    expectedThisMonth: month.reduce((s, i) => s + i.amount, 0),
    collectedThisMonth: month.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amount, 0),
    overdueAmount: overdue._sum.amount ?? 0,
    waitlistCount,
  }
}
