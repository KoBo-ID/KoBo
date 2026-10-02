import { compareDates, todayWIB } from '@kobo/shared/domain'
import { kosIdOnly, visitCompleteInput, visitCreateInput, visitIdInput } from '@kobo/shared/schemas'
import { TRPCError } from '@trpc/server'
import { authedProcedure, ownerProcedure, router } from './trpc.ts'

export interface MyVisit {
  id: string
  /** 'YYYY-MM-DD' (WIB calendar day). */
  date: string
  timeSlot: 'PAGI' | 'SIANG'
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
  notes: string | null
  kos: { id: string; slug: string; name: string }
}

export interface OwnerVisit {
  id: string
  date: string
  timeSlot: 'PAGI' | 'SIANG'
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
  notes: string | null
  student: { name: string; phone: string | null; campus: string | null }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: unknown } | null
  return !!err && (err.code === 'P2002' || `${err.message ?? ''} ${JSON.stringify(err.meta ?? {})}`.includes('23505'))
}

const ALREADY_SCHEDULED = 'Anda sudah punya jadwal survey aktif di kos ini.'
const NOT_SCHEDULED = 'Survey ini sudah selesai atau dibatalkan.'

export const visitRouter = router({
  /** One SCHEDULED visit per student per kos (a partial unique index backs the check). The date must be after today in WIB. */
  create: authedProcedure.input(visitCreateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    const parsed = new Date(`${input.date}T00:00:00Z`)
    const real = !Number.isNaN(parsed.getTime()) && isoDay(parsed) === input.date
    if (!real || compareDates(input.date, todayWIB(new Date())) <= 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tanggal survey harus setelah hari ini.' })
    }
    const kos = await ctx.prisma.kos.findUnique({ where: { id: input.kosId }, select: { id: true } })
    if (!kos) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kos tidak ditemukan.' })
    const conflict = new TRPCError({ code: 'CONFLICT', message: ALREADY_SCHEDULED })
    if ((await ctx.prisma.visit.count({ where: { userId: ctx.user.id, kosId: kos.id, status: 'SCHEDULED' } })) > 0) throw conflict
    try {
      return await ctx.prisma.visit.create({
        data: { kosId: kos.id, userId: ctx.user.id, date: parsed, timeSlot: input.timeSlot, notes: input.notes || null },
        select: { id: true },
      })
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict
      throw e
    }
  }),

  /** The caller's visits, newest date first. */
  mine: authedProcedure.query(async ({ ctx }): Promise<MyVisit[]> => {
    const rows = await ctx.prisma.visit.findMany({
      where: { userId: ctx.user.id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      include: { kos: { select: { id: true, slug: true, name: true } } },
    })
    return rows.map((v) => ({ id: v.id, date: isoDay(v.date), timeSlot: v.timeSlot, status: v.status, notes: v.notes, kos: v.kos }))
  }),

  /** Own visits only, and only while still SCHEDULED. */
  cancel: authedProcedure.input(visitIdInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    const visit = await ctx.prisma.visit.findUnique({ where: { id: input.visitId }, select: { userId: true } })
    if (!visit || visit.userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Anda hanya dapat membatalkan survey Anda sendiri.' })
    const res = await ctx.prisma.visit.updateMany({ where: { id: input.visitId, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } })
    if (res.count === 0) throw new TRPCError({ code: 'CONFLICT', message: NOT_SCHEDULED })
    return { id: input.visitId }
  }),
})

/** owner.visits: every visit of one kos with the student's contact, soonest first. */
export const ownerVisits = ownerProcedure.input(kosIdOnly).query(async ({ ctx, input }): Promise<OwnerVisit[]> => {
  const rows = await ctx.prisma.visit.findMany({
    where: { kosId: input.kosId },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    include: { user: { select: { name: true, phone: true, campus: true } } },
  })
  return rows.map((v) => ({ id: v.id, date: isoDay(v.date), timeSlot: v.timeSlot, status: v.status, notes: v.notes, student: v.user }))
})

/** owner.visit: the visit is looked up inside the (already authorized) kos, so a foreign visit id is NOT_FOUND. */
export const ownerVisitRouter = router({
  complete: ownerProcedure.input(visitCompleteInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    const visit = await ctx.prisma.visit.findFirst({ where: { id: input.visitId, kosId: input.kosId }, select: { id: true } })
    if (!visit) throw new TRPCError({ code: 'NOT_FOUND', message: 'Jadwal survey tidak ditemukan.' })
    const res = await ctx.prisma.visit.updateMany({ where: { id: visit.id, status: 'SCHEDULED' }, data: { status: 'COMPLETED' } })
    if (res.count === 0) throw new TRPCError({ code: 'CONFLICT', message: NOT_SCHEDULED })
    return { id: visit.id }
  }),
})
