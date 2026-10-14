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
  /**
   * Safe payment label for the live tenancy's open invoice. Never carries a checkout URL or tenant-only controls.
   * AWAITING_ONLINE: the tenant is mid online payment (manual entry is blocked). REFUND_PENDING / REFUNDED: a late payment is on its way back / was returned.
   */
  payment: { state: 'AWAITING_ONLINE' | 'VERIFIED' | 'MANUAL' | 'REFUND_PENDING' | 'REFUNDED' | 'NEEDS_REVIEW'; expiresAt: string | null } | null
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
          invoices: { orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], include: {
              payments: {
                where: { status: { in: ['PAID', 'CREATING', 'PENDING', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED'] } },
                // Explicit select: checkoutUrl and provider ids are never loaded for the owner.
                select: { id: true, provider: true, status: true, expiresAt: true, paidAt: true, receiptNo: true, createdAt: true },
                orderBy: { paidAt: 'desc' },
              },
            },
          },
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
    const allPayments = live ? live.invoices.flatMap((i) => i.payments) : []
    const receipts = allPayments.filter((p) => p.status === 'PAID' && p.paidAt)
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
      payment: boardPayment(live?.invoices.find((i) => i.status === 'UNPAID')?.payments ?? [], last?.provider, now),
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

type BoardPayment = BoardRoom['payment']

/** Label for the open invoice's attempts only (a paid invoice shows its receipt instead). */
function boardPayment(payments: { provider: 'XENDIT' | 'MOCK' | 'MANUAL'; status: string; expiresAt: Date | null; createdAt: Date }[], lastPaidBy: 'XENDIT' | 'MOCK' | 'MANUAL' | undefined, now: Date): BoardPayment {
  const live = payments.find((p) => p.provider !== 'MANUAL' && (p.status === 'CREATING' || p.status === 'PENDING') && (!p.expiresAt || p.expiresAt > now))
  if (live) return { state: 'AWAITING_ONLINE', expiresAt: live.expiresAt?.toISOString() ?? null }
  // Worst first: a failed refund needs a person, then one still in flight, then one that is done.
  if (payments.some((p) => p.status === 'REFUND_FAILED')) return { state: 'NEEDS_REVIEW', expiresAt: null }
  if (payments.some((p) => p.status === 'REFUND_PENDING')) return { state: 'REFUND_PENDING', expiresAt: null }
  if (payments.some((p) => p.status === 'REFUNDED')) return { state: 'REFUNDED', expiresAt: null }
  // Nothing open: say how the newest receipt was verified. Collected by Xendit is verified; a MOCK demo payment shows nothing.
  if (lastPaidBy === 'XENDIT') return { state: 'VERIFIED', expiresAt: null }
  if (lastPaidBy === 'MANUAL') return { state: 'MANUAL', expiresAt: null }
  return null
}
