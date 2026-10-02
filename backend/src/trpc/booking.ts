import { randomUUID } from 'node:crypto'
import { addDays, computeCheckoutTotal, deriveRoomStatus, formatReceiptNo, todayWIB } from '@kobo/shared/domain'
import { bookingCreateInput } from '@kobo/shared/schemas'
import type { RoomStatus } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import { mockInstructions } from '../payments.ts'
import { advanceWaitlist, liveOffer } from '../waitlist.ts'
import { reviewEditable, reviewEligible } from './review.ts'
import { authedProcedure, router } from './trpc.ts'

/** A PENDING tenancy holds its room for this long (spec section 6). */
export const HOLD_HOURS = 24
/** How far ahead a move-in date may be. */
const MAX_START_AHEAD_DAYS = 120

export const CONFLICT_MESSAGE = 'Kamar baru saja dibooking orang lain.'
export const OFFERED_ELSEWHERE_MESSAGE = 'Kamar ini sedang ditawarkan ke pengantre lain.'

export interface BookingBreakdown {
  rent: number
  applicationFee: number
  discount: number
  total: number
}

export interface PaymentSummary {
  id: string
  externalId: string
  provider: 'MOCK' | 'MANUAL'
  status: 'PENDING' | 'PAID' | 'FAILED'
  amount: number
  instructions: { bcaVa: string; mandiriVa: string; qris: string }
}

export interface BookingCreated {
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
  payment: PaymentSummary
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
  /** The unpaid mock payment of a live hold, so checkout can be resumed. */
  pendingPaymentId: string | null
  /** Activated (ACTIVE, or ENDED after a paid invoice) and not yet reviewed. */
  canReview: boolean
  review: MyReview | null
}

const OFFERED_ELSEWHERE = Symbol('offered-elsewhere')

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

/** Unique-violation on the one-live-tenancy-per-room index, whichever shape the driver adapter reports it in. */
function isRoomTakenError(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: { driverAdapterError?: { cause?: { kind?: string; constraint?: unknown } } } } | null
  if (!err) return false
  if (err.code === 'P2002') return true
  const text = `${err.message ?? ''} ${JSON.stringify(err.meta ?? {})}`
  return text.includes('tenancy_one_active_per_room') || text.includes('23505')
}

export const bookingRouter = router({
  /**
   * Self-healing booking transaction (spec section 6): expire this room's lapsed holds, then insert. The partial
   * unique index decides a race: the loser gets CONFLICT. The server is the only price authority; the input has no price.
   */
  create: authedProcedure.input(bookingCreateInput).mutation(async ({ ctx, input }): Promise<BookingCreated> => {
    const { prisma } = ctx
    const now = new Date()
    const today = todayWIB(now)
    if (input.startDate < today) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal mulai tidak boleh di masa lalu.' })
    if (input.startDate > addDays(today, MAX_START_AHEAD_DAYS)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal mulai terlalu jauh dari hari ini.' })
    if (Number.isNaN(new Date(`${input.startDate}T00:00:00Z`).getTime())) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal mulai tidak valid.' })

    const [room, user] = await Promise.all([
      prisma.room.findUnique({ where: { id: input.roomId }, include: { kos: true } }),
      prisma.user.findUnique({ where: { id: ctx.user.id }, select: { campusEmailVerifiedAt: true } }),
    ])
    if (!room) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kamar tidak ditemukan.' })
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Silakan masuk terlebih dahulu.' })

    const breakdown = computeCheckoutTotal({
      monthlyRent: room.priceMonthly,
      applicationFee: room.kos.applicationFee,
      discountAmount: room.kos.studentDiscountAmount,
      campusEmailVerified: user.campusEmailVerifiedAt !== null,
    })
    const dueDate = new Date(`${input.startDate}T00:00:00Z`)
    const externalId = `mock_${randomUUID()}`

    try {
      const booked = await prisma.$transaction(async (tx): Promise<BookingCreated | typeof OFFERED_ELSEWHERE> => {
        await tx.tenancy.updateMany({
          where: { roomId: room.id, status: 'PENDING', expiresAt: { lt: now } },
          data: { status: 'ENDED', endedAt: now },
        })
        // Holds lapse lazily, so settle the queue now: a room that just came free is already offered to #1 when the guard below runs.
        await advanceWaitlist(tx, room.kosId, now)
        const offer = await tx.waitlistEntry.findFirst({ where: { offeredRoomId: room.id, ...liveOffer(now) }, select: { userId: true } })
        // Returned, not thrown: the advance above must commit so the room really is offered to #1 (and #1 gets the email).
        if (offer && offer.userId !== ctx.user.id) return OFFERED_ELSEWHERE
        const tenancy = await tx.tenancy.create({
          data: {
            roomId: room.id,
            userId: ctx.user.id,
            status: 'PENDING',
            startDate: new Date(`${input.startDate}T00:00:00+07:00`),
            durationMonths: input.durationMonths,
            expiresAt: new Date(now.getTime() + HOLD_HOURS * 3600_000),
          },
        })
        const invoice = await tx.invoice.create({
          data: { tenancyId: tenancy.id, periodStart: dueDate, dueDate, amount: breakdown.total, status: 'UNPAID' },
        })
        const payment = await tx.payment.create({
          data: { invoiceId: invoice.id, provider: 'MOCK', externalId, amount: breakdown.total, status: 'PENDING' },
        })
        // Booking ends this student's place in the queue (their offer, or a waiting entry when they take another open room).
        const queued = await tx.waitlistEntry.findMany({ where: { kosId: room.kosId, userId: ctx.user.id, status: { in: ['WAITING', 'OFFERED'] } }, select: { id: true, status: true, offeredRoomId: true } })
        if (queued.length > 0) {
          await tx.waitlistEntry.updateMany({ where: { id: { in: queued.map((q) => q.id) } }, data: { status: 'FULFILLED', resolvedAt: now } })
          // An offer on a different room than the one booked is released to the next entry.
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
          payment: { id: payment.id, externalId, provider: 'MOCK', status: 'PENDING', amount: payment.amount, instructions: mockInstructions(externalId) },
        }
      })
      if (booked === OFFERED_ELSEWHERE) throw new TRPCError({ code: 'CONFLICT', message: OFFERED_ELSEWHERE_MESSAGE })
      return booked
    } catch (e) {
      if (isRoomTakenError(e)) throw new TRPCError({ code: 'CONFLICT', message: CONFLICT_MESSAGE })
      throw e
    }
  }),

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
      const pending = live ? t.invoices.flatMap((i) => i.payments).find((p) => p.status === 'PENDING' && p.provider === 'MOCK') : undefined
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
          return {
            id: i.id,
            status: i.status,
            dueDate: dateOnly(i.dueDate),
            amount: i.amount,
            receiptNo: paid?.paidAt ? formatReceiptNo(paid.receiptNo, paid.paidAt) : null,
            receiptNumber: paid ? paid.receiptNo : null,
          }
        }),
        pendingPaymentId: pending?.id ?? null,
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
