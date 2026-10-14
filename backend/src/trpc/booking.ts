import { computeCheckoutTotal, deriveRoomStatus, formatReceiptNo, todayWIB } from '@kobo/shared/domain'
import type { RoomStatus } from '@kobo/shared/types'
import type { Prisma } from '../generated/prisma/client.ts'
import { isLiveAttempt, toPaymentSummary } from '../payment/summary.ts'
import type { PaymentSummary } from '../payment/summary.ts'
import { advanceWaitlist, liveOffer } from '../waitlist.ts'
import { reviewEditable, reviewEligible } from './review.ts'
import { authedProcedure, router } from './trpc.ts'

/** A PENDING tenancy holds its room for this long (spec section 6). */
export const HOLD_HOURS = 24
export const CONFLICT_MESSAGE = 'Kamar baru saja dibooking orang lain.'
export const OFFERED_ELSEWHERE_MESSAGE = 'Kamar ini sedang ditawarkan ke pengantre lain.'

export interface BookingBreakdown {
  rent: number
  applicationFee: number
  discount: number
  total: number
}

export interface ApprovedTenancyObligation {
  tenancyId: string
  roomId: string
  kosId: string
  /** ISO timestamp: the hold lapses after this. */
  expiresAt: string
  /** YYYY-MM-DD */
  startDate: string
  durationMonths: number
  invoiceId: string
  breakdown: BookingBreakdown
}

export interface MyInvoice {
  id: string
  status: 'UNPAID' | 'PAID'
  /** YYYY-MM-DD (WIB calendar day) */
  dueDate: string
  amount: number
  /** KB/YYYY/MM/NNNN once paid, else null. */
  receiptNo: string | null
  /** The raw Payment.receiptNo used in /kuitansi/:receiptNo. */
  receiptNumber: number | null
  /** The open online attempt (CREATING/PENDING, not lapsed), if any. */
  activePayment: PaymentSummary | null
  /** The newest attempt of any provider, so a failed or refunded outcome stays visible. */
  latestPayment: PaymentSummary | null
  /** Unpaid, no open attempt, and the tenancy can still be paid (ACTIVE, or a live PENDING hold). */
  canPay: boolean
}

export interface MyReview {
  id: string
  rating: number
  subRatings: { cleanliness: number | null; wifi: number | null; owner: number | null; quietness: number | null }
  comment: string
  createdAt: string
  /** Still inside the author's 14-day edit window. */
  editable: boolean
}

export interface MyTenancy {
  id: string
  status: 'PENDING' | 'ACTIVE' | 'ENDED'
  /** Derived on read: a lapsed PENDING hold reads as vacant. */
  derivedStatus: RoomStatus
  startDate: string
  durationMonths: number
  expiresAt: string | null
  kos: { id: string; name: string; address: string; image: string | null; ownerName: string; ownerPhone: string | null }
  room: { id: string; roomNumber: string; floor: number; type: string; priceMonthly: number }
  invoices: MyInvoice[]
  /** Activated (ACTIVE, or ENDED after a paid invoice) and not yet reviewed. */
  canReview: boolean
  review: MyReview | null
}

export const OFFERED_ELSEWHERE = Symbol('offered-elsewhere')

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

/** Unique-violation on the one-live-tenancy-per-room index, whichever shape the driver adapter reports it in. */
export function isRoomTakenError(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: { driverAdapterError?: { cause?: { kind?: string; constraint?: unknown } } } } | null
  if (!err) return false
  if (err.code === 'P2002') return true
  const text = `${err.message ?? ''} ${JSON.stringify(err.meta ?? {})}`
  return text.includes('tenancy_one_active_per_room') || text.includes('23505')
}

interface ApprovedTenancyInput {
  userId: string
  startDate: string
  durationMonths: number
  campusEmailVerified: boolean
  room: {
    id: string
    kosId: string
    priceMonthly: number
    kos: { applicationFee: number; studentDiscountAmount: number }
  }
  now: Date
}

/** Creates a timed tenancy hold and its first invoice after an owner approves an application. */
export async function createApprovedTenancyObligation(
  tx: Prisma.TransactionClient,
  input: ApprovedTenancyInput,
): Promise<ApprovedTenancyObligation | typeof OFFERED_ELSEWHERE> {
  const { room, now } = input
  const breakdown = computeCheckoutTotal({
    monthlyRent: room.priceMonthly,
    applicationFee: room.kos.applicationFee,
    discountAmount: room.kos.studentDiscountAmount,
    campusEmailVerified: input.campusEmailVerified,
  })
  const dueDate = new Date(`${input.startDate}T00:00:00Z`)

  await tx.tenancy.updateMany({
    where: { roomId: room.id, status: 'PENDING', expiresAt: { lt: now } },
    data: { status: 'ENDED', endedAt: now },
  })
  await advanceWaitlist(tx, room.kosId, now)
  const offer = await tx.waitlistEntry.findFirst({ where: { offeredRoomId: room.id, ...liveOffer(now) }, select: { userId: true } })
  if (offer && offer.userId !== input.userId) return OFFERED_ELSEWHERE

  const tenancy = await tx.tenancy.create({
    data: {
      roomId: room.id,
      userId: input.userId,
      status: 'PENDING',
      startDate: new Date(`${input.startDate}T00:00:00+07:00`),
      durationMonths: input.durationMonths,
      expiresAt: new Date(now.getTime() + HOLD_HOURS * 3600_000),
    },
  })
  const invoice = await tx.invoice.create({
    data: {
      tenancyId: tenancy.id,
      periodStart: dueDate,
      dueDate,
      amount: breakdown.total,
      rentAmount: breakdown.rent,
      discountAmount: breakdown.discount,
      applicationFeeAmount: breakdown.applicationFee,
      ownerReceivableAmount: breakdown.rent - breakdown.discount,
      gatewayFeeBearer: 'PLATFORM',
      status: 'UNPAID',
    },
  })

  const queued = await tx.waitlistEntry.findMany({
    where: { kosId: room.kosId, userId: input.userId, status: { in: ['WAITING', 'OFFERED'] } },
    select: { id: true, status: true, offeredRoomId: true },
  })
  if (queued.length > 0) {
    await tx.waitlistEntry.updateMany({ where: { id: { in: queued.map((q) => q.id) } }, data: { status: 'FULFILLED', resolvedAt: now } })
    if (queued.some((q) => q.status === 'OFFERED' && q.offeredRoomId !== room.id)) await advanceWaitlist(tx, room.kosId, now)
  }

  return {
    tenancyId: tenancy.id,
    roomId: room.id,
    kosId: room.kosId,
    expiresAt: tenancy.expiresAt!.toISOString(),
    startDate: input.startDate,
    durationMonths: input.durationMonths,
    invoiceId: invoice.id,
    breakdown,
  }
}

export const bookingRouter = router({
  /** The signed-in student's tenancies, newest first. Receipt numbers are formatted only once an invoice is paid. */
  mine: authedProcedure.query(async ({ ctx }): Promise<MyTenancy[]> => {
    const now = new Date()
    const rows = await ctx.prisma.tenancy.findMany({
      where: { userId: ctx.user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: {
        room: { include: { kos: { include: { images: { orderBy: { order: 'asc' }, take: 1 }, owner: { include: { user: { select: { name: true, phone: true } } } } } } } },
        invoices: { orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], include: { payments: { orderBy: { createdAt: 'asc' } } } },
        review: true,
      },
    })
    return rows.map((t): MyTenancy => {
      const oldestUnpaid = t.invoices.find((i) => i.status === 'UNPAID')
      const live = t.status === 'PENDING' && t.expiresAt !== null && t.expiresAt.getTime() >= now.getTime()
      const img = t.room.kos.images[0]
      return {
        id: t.id,
        status: t.status,
        derivedStatus: deriveRoomStatus({
          occupancy: t.room.occupancy,
          tenancy: { status: t.status, expiresAt: t.expiresAt?.toISOString() ?? null },
          oldestUnpaidInvoice: oldestUnpaid ? { dueDate: dateOnly(oldestUnpaid.dueDate) } : null,
          now,
        }),
        startDate: todayWIB(t.startDate),
        durationMonths: t.durationMonths,
        expiresAt: t.expiresAt?.toISOString() ?? null,
        kos: {
          id: t.room.kos.id,
          name: t.room.kos.name,
          address: t.room.kos.address,
          image: img ? (img.url ?? ctx.storage.publicUrl(img.key!)) : null,
          ownerName: t.room.kos.owner.user.name,
          ownerPhone: t.room.kos.owner.user.phone,
        },
        room: { id: t.room.id, roomNumber: t.room.roomNumber, floor: t.room.floor, type: t.room.type, priceMonthly: t.room.priceMonthly },
        invoices: t.invoices.map((i) => {
          const paid = i.payments.find((p) => p.status === 'PAID')
          const active = i.payments.find((p) => isLiveAttempt(p, now))
          const latest = i.payments.at(-1)
          return {
            id: i.id,
            status: i.status,
            dueDate: dateOnly(i.dueDate),
            amount: i.amount,
            receiptNo: paid?.paidAt ? formatReceiptNo(paid.receiptNo, paid.paidAt) : null,
            receiptNumber: paid ? paid.receiptNo : null,
            activePayment: active ? toPaymentSummary(active, now) : null,
            latestPayment: latest ? toPaymentSummary(latest, now) : null,
            canPay: i.status === 'UNPAID' && !active && (t.status === 'ACTIVE' || live),
          }
        }),
        canReview: !t.review && reviewEligible(t),
        review: t.review
          ? {
              id: t.review.id,
              rating: t.review.rating,
              subRatings: { cleanliness: t.review.cleanliness, wifi: t.review.wifi, owner: t.review.ownerRating, quietness: t.review.quietness },
              comment: t.review.comment,
              createdAt: t.review.createdAt.toISOString(),
              editable: reviewEditable(t.review.createdAt, now),
            }
          : null,
      }
    })
  }),
})
