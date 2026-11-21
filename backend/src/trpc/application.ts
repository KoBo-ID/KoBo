import { addDays, isCalendarDay, isStudentVerified, todayWIB } from '@kobo/shared/domain'
import { rentalApplicationCreateInput, rentalApplicationDecisionInput, kosIdOnly } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import type { Prisma } from '../generated/prisma/client.ts'
import { assertApplicationConsents } from '../consents.ts'
import { assertDemoIsolation } from '../demoIsolation.ts'
import { advanceWaitlist, liveOffer, lockKos } from '../waitlist.ts'
import { isDiscountEligible } from '../affiliation.ts'
import { CONFLICT_MESSAGE, createApprovedTenancyObligation, isRoomTakenError, OFFERED_ELSEWHERE, OFFERED_ELSEWHERE_MESSAGE } from './booking.ts'
import type { CampusVerifyMethod } from '@kobo/shared/types'
import { authedProcedure, ownerProcedure, router, studentProcedure } from './trpc.ts'

const MAX_START_AHEAD_DAYS = 120
const ROOM_UNAVAILABLE = Symbol('room-unavailable')
const ALREADY_RENTING = Symbol('already-renting')

type ApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'

export interface MyRentalApplication {
  id: string
  status: ApplicationStatus
  startDate: string
  durationMonths: number
  /** Snapshot such as "Mahasiswa BINUS"; null on very old rows. */
  occupation: string | null
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
  /** Kept for old rows; new rows carry a "Mahasiswa <campus>" snapshot. */
  occupation: string | null
  program: string | null
  semester: number | null
  /** Verified at the time the owner looks (expiry-aware). */
  student: { verified: boolean; via: CampusVerifyMethod | null; campus: string | null }
  note: string | null
  createdAt: string
  /** No phone here: the number is released only through owner.tenant.tenantProfile once the application is approved. */
  applicant: { name: string; campus: string | null }
  room: { id: string; roomNumber: string; type: string }
}

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

function validateStartDate(startDate: string, now: Date) {
  // B-07: a real calendar day (the Zod schema refines it too; `new Date('2026-11-31')` would roll over to 1 December).
  if (!isCalendarDay(startDate)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal mulai tidak valid.' })
  const today = todayWIB(now)
  if (startDate < today) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal mulai tidak boleh di masa lalu.' })
  if (startDate > addDays(today, MAX_START_AHEAD_DAYS)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal mulai terlalu jauh dari hari ini.' })
}

/** A-013: only the one-pending-per-user-room index means "duplicate application"; any other unique violation is a real error. */
export function isDuplicatePendingError(e: unknown): boolean {
  const err = e as { message?: string; meta?: unknown } | null
  if (!err) return false
  return `${err.message ?? ''} ${JSON.stringify(err.meta ?? {})}`.includes('rental_application_one_pending_per_user_room')
}

const ALREADY_DECIDED = 'Pengajuan ini sudah diputuskan.'

/**
 * Live (ACTIVE, or unexpired PENDING hold) tenancies this user has in the kos. Same rule as waitlist.join's `rentingInKos`
 * (trpc/waitlist.ts does not export it, so the one-liner is repeated here): paying first never buys a second room in a kos.
 */
const rentingInKos = (tx: Prisma.TransactionClient, userId: string, kosId: string, now: Date) =>
  tx.tenancy.count({ where: { userId, room: { kosId }, OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gt: now } }] } })

/**
 * Compare-and-set: only a still-PENDING application can be decided. Under READ COMMITTED a second UPDATE waits for the
 * first, re-checks `status = 'PENDING'` against the committed row and matches nothing, so exactly one decision wins.
 * (Same pattern as waitlist leave/decline and visit cancel.)
 */
async function claimDecision(tx: Prisma.TransactionClient, applicationId: string, data: Prisma.RentalApplicationUncheckedUpdateManyInput) {
  const res = await tx.rentalApplication.updateMany({ where: { id: applicationId, status: 'PENDING' }, data })
  if (res.count === 0) throw new TRPCError({ code: 'CONFLICT', message: ALREADY_DECIDED })
}

export const applicationRouter = router({
  create: studentProcedure.input(rentalApplicationCreateInput).mutation(async ({ ctx, input }): Promise<{ id: string; status: 'PENDING' }> => {
    const now = new Date()
    validateStartDate(input.startDate, now)
    const room = await ctx.prisma.room.findFirst({ where: { id: input.roomId, archivedAt: null, kos: { archivedAt: null } }, select: { id: true, kosId: true, kos: { select: { owner: { select: { userId: true } } } } } })
    if (!room) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kamar tidak ditemukan.' })
    if (room.kos.owner.userId === ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Anda tidak bisa menyewa kamar di kos Anda sendiri.' })
    await assertDemoIsolation(ctx.prisma, ctx.user, room.kosId)
    await assertApplicationConsents(ctx.prisma, ctx.user.id)
    const me = await ctx.prisma.user.findUnique({ where: { id: ctx.user.id }, select: { campus: true } })
    const occupation = `Mahasiswa ${me?.campus ?? ''}`.trim()

    try {
      const created = await ctx.prisma.$transaction(async (tx) => {
        await lockKos(tx, room.kosId)
        await tx.tenancy.updateMany({
          where: { roomId: room.id, status: 'PENDING', expiresAt: { lte: now } },
          data: { status: 'ENDED', endedAt: now },
        })
        await advanceWaitlist(tx, room.kosId, now)
        if ((await rentingInKos(tx, ctx.user.id, room.kosId, now)) > 0) return ALREADY_RENTING
        const offer = await tx.waitlistEntry.findFirst({ where: { offeredRoomId: room.id, ...liveOffer(now) }, select: { id: true, userId: true, applicationId: true } })
        if (offer && offer.userId !== ctx.user.id) return OFFERED_ELSEWHERE
        const liveTenancy = await tx.tenancy.count({
          where: { roomId: room.id, OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gt: now } }] },
        })
        if (liveTenancy > 0) return ROOM_UNAVAILABLE
        const application = await tx.rentalApplication.create({
          data: {
            roomId: room.id,
            userId: ctx.user.id,
            startDate: new Date(`${input.startDate}T00:00:00Z`),
            durationMonths: input.durationMonths,
            occupation,
            program: input.program || null,
            semester: input.semester ?? null,
            note: input.note || null,
          },
          select: { id: true },
        })
        // A-007: the offeree's application holds the offer while the owner reviews it (see liveOffer / advanceWaitlist).
        if (offer && !offer.applicationId) await tx.waitlistEntry.update({ where: { id: offer.id }, data: { applicationId: application.id } })
        return { id: application.id, status: 'PENDING' as const }
      })
      if (created === OFFERED_ELSEWHERE) throw new TRPCError({ code: 'CONFLICT', message: OFFERED_ELSEWHERE_MESSAGE })
      if (created === ALREADY_RENTING) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Anda sudah menyewa kamar di kos ini.' })
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
      include: { user: { select: { name: true, campus: true, campusEmailVerifiedAt: true, campusVerifiedUntil: true, campusVerifiedVia: true } }, room: { select: { id: true, roomNumber: true, type: true } } },
    })
    const now = new Date()
    return rows.map((a) => ({
      id: a.id,
      status: a.status,
      startDate: dateOnly(a.startDate),
      durationMonths: a.durationMonths,
      occupation: a.occupation,
      program: a.program,
      semester: a.semester,
      student: { verified: isStudentVerified(a.user, now), via: a.user.campusVerifiedVia, campus: a.user.campus },
      note: a.note,
      createdAt: a.createdAt.toISOString(),
      applicant: { name: a.user.name, campus: a.user.campus },
      room: a.room,
    }))
  }),

  decide: ownerProcedure.input(rentalApplicationDecisionInput).mutation(async ({ ctx, input }): Promise<{ id: string; status: 'APPROVED' | 'REJECTED'; tenancyId: string | null }> => {
    const now = new Date()
    try {
      const result = await ctx.prisma.$transaction(async (tx) => {
        // Kos lock first (A-001 lock order); input.kosId is the caller's own kos and the application is looked up inside it.
        await lockKos(tx, input.kosId)
        const application = await tx.rentalApplication.findFirst({
          where: { id: input.applicationId, room: { kosId: input.kosId } },
          include: { room: { include: { kos: true } }, user: { select: { campusEmailVerifiedAt: true, campusVerifiedUntil: true, verifiedCampusId: true } } },
        })
        if (!application) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pengajuan tidak ditemukan.' })
        if (application.status !== 'PENDING') throw new TRPCError({ code: 'CONFLICT', message: 'Pengajuan ini sudah diputuskan.' })

        if (input.decision === 'REJECT') {
          await claimDecision(tx, application.id, { status: 'REJECTED', decidedAt: now })
          // A rejected offeree application ends the offer at once (A-007): hand the room to the next waiter in the same tx.
          const linked = await tx.waitlistEntry.count({ where: { applicationId: application.id, status: 'OFFERED' } })
          if (linked > 0) await advanceWaitlist(tx, input.kosId, now)
          return { id: application.id, status: 'REJECTED' as const, tenancyId: null }
        }

        // S-2: the start date was only checked when the student applied; an old application must not become an overdue invoice.
        if (dateOnly(application.startDate) < todayWIB(now)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal mulai pengajuan ini sudah lewat. Tolak pengajuan ini dan minta penyewa mengajukan ulang.' })
        }
        // G2-05: the student may have been approved into another room of this kos since they applied.
        if ((await rentingInKos(tx, application.userId, input.kosId, now)) > 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Penyewa ini sudah menyewa kamar lain di kos ini.' })
        }

        const booked = await createApprovedTenancyObligation(tx, {
          userId: application.userId,
          startDate: dateOnly(application.startDate),
          durationMonths: application.durationMonths,
          // "Diskon Kampus Mitra" is judged at DECIDE time (the moment the price is fixed): verified now AND an affiliated campus.
          discountEligible: await isDiscountEligible(tx, application.user, now),
          room: application.room,
          now,
        })
        if (booked === OFFERED_ELSEWHERE) return OFFERED_ELSEWHERE
        // Throws (and rolls the new tenancy back) when a concurrent REJECT already took the decision.
        await claimDecision(tx, application.id, { status: 'APPROVED', decidedAt: now, tenancyId: booked.tenancyId })
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
