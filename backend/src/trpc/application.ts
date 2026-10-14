import { addDays, todayWIB } from '@kobo/shared/domain'
import { rentalApplicationCreateInput, rentalApplicationDecisionInput, kosIdOnly } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import { advanceWaitlist, liveOffer } from '../waitlist.ts'
import { CONFLICT_MESSAGE, createApprovedTenancyObligation, isRoomTakenError, OFFERED_ELSEWHERE, OFFERED_ELSEWHERE_MESSAGE } from './booking.ts'
import { authedProcedure, ownerProcedure, router } from './trpc.ts'

const MAX_START_AHEAD_DAYS = 120
const ROOM_UNAVAILABLE = Symbol('room-unavailable')

type ApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'

export interface MyRentalApplication {
  id: string
  status: ApplicationStatus
  startDate: string
  durationMonths: number
  occupation: string
  note: string | null
  createdAt: string
  decidedAt: string | null
  tenancyId: string | null
  kos: { id: string; name: string; image: string | null }
  room: { id: string; roomNumber: string; type: string }
}

export interface OwnerRentalApplication {
  id: string
  status: ApplicationStatus
  startDate: string
  durationMonths: number
  occupation: string
  note: string | null
  createdAt: string
  applicant: { name: string; phone: string | null; campus: string | null }
  room: { id: string; roomNumber: string; type: string }
}

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

function validateStartDate(startDate: string, now: Date) {
  const today = todayWIB(now)
  if (startDate < today) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal mulai tidak boleh di masa lalu.' })
  if (startDate > addDays(today, MAX_START_AHEAD_DAYS)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal mulai terlalu jauh dari hari ini.' })
  if (Number.isNaN(new Date(`${startDate}T00:00:00Z`).getTime())) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal mulai tidak valid.' })
}

function isDuplicatePendingError(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: unknown } | null
  if (!err) return false
  return err.code === 'P2002' || `${err.message ?? ''} ${JSON.stringify(err.meta ?? {})}`.includes('rental_application_one_pending_per_user_room')
}

export const applicationRouter = router({
  create: authedProcedure.input(rentalApplicationCreateInput).mutation(async ({ ctx, input }): Promise<{ id: string; status: 'PENDING' }> => {
    const now = new Date()
    validateStartDate(input.startDate, now)
    const room = await ctx.prisma.room.findUnique({ where: { id: input.roomId }, select: { id: true, kosId: true } })
    if (!room) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kamar tidak ditemukan.' })

    try {
      const created = await ctx.prisma.$transaction(async (tx) => {
        await tx.tenancy.updateMany({
          where: { roomId: room.id, status: 'PENDING', expiresAt: { lt: now } },
          data: { status: 'ENDED', endedAt: now },
        })
        await advanceWaitlist(tx, room.kosId, now)
        const offer = await tx.waitlistEntry.findFirst({ where: { offeredRoomId: room.id, ...liveOffer(now) }, select: { userId: true } })
        if (offer && offer.userId !== ctx.user.id) return OFFERED_ELSEWHERE
        const liveTenancy = await tx.tenancy.count({
          where: { roomId: room.id, OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gte: now } }] },
        })
        if (liveTenancy > 0) return ROOM_UNAVAILABLE
        const application = await tx.rentalApplication.create({
          data: {
            roomId: room.id,
            userId: ctx.user.id,
            startDate: new Date(`${input.startDate}T00:00:00Z`),
            durationMonths: input.durationMonths,
            occupation: input.occupation,
            note: input.note || null,
          },
          select: { id: true },
        })
        return { id: application.id, status: 'PENDING' as const }
      })
      if (created === OFFERED_ELSEWHERE) throw new TRPCError({ code: 'CONFLICT', message: OFFERED_ELSEWHERE_MESSAGE })
      if (created === ROOM_UNAVAILABLE) throw new TRPCError({ code: 'CONFLICT', message: 'Kamar ini sudah tidak tersedia untuk pengajuan.' })
      return created
    } catch (e) {
      if (isDuplicatePendingError(e)) throw new TRPCError({ code: 'CONFLICT', message: 'Anda sudah memiliki pengajuan aktif untuk kamar ini.' })
      throw e
    }
  }),

  mine: authedProcedure.query(async ({ ctx }): Promise<MyRentalApplication[]> => {
    const rows = await ctx.prisma.rentalApplication.findMany({
      where: { userId: ctx.user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: { room: { include: { kos: { include: { images: { orderBy: { order: 'asc' }, take: 1 } } } } } },
    })
    return rows.map((a) => {
      const image = a.room.kos.images[0]
      return {
        id: a.id,
        status: a.status,
        startDate: dateOnly(a.startDate),
        durationMonths: a.durationMonths,
        occupation: a.occupation,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
        decidedAt: a.decidedAt?.toISOString() ?? null,
        tenancyId: a.tenancyId,
        kos: { id: a.room.kos.id, name: a.room.kos.name, image: image ? (image.url ?? ctx.storage.publicUrl(image.key!)) : null },
        room: { id: a.room.id, roomNumber: a.room.roomNumber, type: a.room.type },
      }
    })
  }),

  ownerList: ownerProcedure.input(kosIdOnly).query(async ({ ctx, input }): Promise<OwnerRentalApplication[]> => {
    const rows = await ctx.prisma.rentalApplication.findMany({
      where: { room: { kosId: input.kosId }, status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { user: { select: { name: true, phone: true, campus: true } }, room: { select: { id: true, roomNumber: true, type: true } } },
    })
    return rows.map((a) => ({
      id: a.id,
      status: a.status,
      startDate: dateOnly(a.startDate),
      durationMonths: a.durationMonths,
      occupation: a.occupation,
      note: a.note,
      createdAt: a.createdAt.toISOString(),
      applicant: a.user,
      room: a.room,
    }))
  }),

  decide: ownerProcedure.input(rentalApplicationDecisionInput).mutation(async ({ ctx, input }): Promise<{ id: string; status: 'APPROVED' | 'REJECTED'; tenancyId: string | null }> => {
    const now = new Date()
    try {
      const result = await ctx.prisma.$transaction(async (tx) => {
        const application = await tx.rentalApplication.findFirst({
          where: { id: input.applicationId, room: { kosId: input.kosId } },
          include: { room: { include: { kos: true } }, user: { select: { campusEmailVerifiedAt: true } } },
        })
        if (!application) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pengajuan tidak ditemukan.' })
        if (application.status !== 'PENDING') throw new TRPCError({ code: 'CONFLICT', message: 'Pengajuan ini sudah diputuskan.' })

        if (input.decision === 'REJECT') {
          await tx.rentalApplication.update({ where: { id: application.id }, data: { status: 'REJECTED', decidedAt: now } })
          return { id: application.id, status: 'REJECTED' as const, tenancyId: null }
        }

        const booked = await createApprovedTenancyObligation(tx, {
          userId: application.userId,
          startDate: dateOnly(application.startDate),
          durationMonths: application.durationMonths,
          campusEmailVerified: application.user.campusEmailVerifiedAt !== null,
          room: application.room,
          now,
        })
        if (booked === OFFERED_ELSEWHERE) return OFFERED_ELSEWHERE
        await tx.rentalApplication.update({
          where: { id: application.id },
          data: { status: 'APPROVED', decidedAt: now, tenancyId: booked.tenancyId },
        })
        await tx.rentalApplication.updateMany({
          where: { roomId: application.roomId, status: 'PENDING', id: { not: application.id } },
          data: { status: 'REJECTED', decidedAt: now },
        })
        return { id: application.id, status: 'APPROVED' as const, tenancyId: booked.tenancyId }
      })
      if (result === OFFERED_ELSEWHERE) throw new TRPCError({ code: 'CONFLICT', message: OFFERED_ELSEWHERE_MESSAGE })
      return result
    } catch (e) {
      if (isRoomTakenError(e)) throw new TRPCError({ code: 'CONFLICT', message: CONFLICT_MESSAGE })
      throw e
    }
  }),
})
