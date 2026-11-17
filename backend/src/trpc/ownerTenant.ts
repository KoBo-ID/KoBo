import { TRPCError } from '@trpc/server'
import { compareDates, todayWIB } from '@kobo/shared/domain'
import { tenantProfileInput } from '@kobo/shared/schemas'
import { z } from 'zod'
import { ownerProcedure, router } from './trpc.ts'

export interface TenantProfile {
  name: string
  campus: string | null
  campusVerified: boolean
  /** The student's WhatsApp number, only once an application is approved or a tenancy exists. */
  phone: string | null
  /** How the owner reached this profile: a pending or decided application, or a tenancy. */
  basis: 'APPLICATION' | 'TENANCY'
  /** True once the student is accepted (application approved) or holds a tenancy: unlocks phone and emergency contact. */
  accepted: boolean
  emergencyContact: { name: string; relation: string; phone: string } | null
  /** Reviews this student wrote about kos they rented, and the average rating they gave. */
  reviews: { count: number; averageGiven: number | null }
  /** Invoices across the student's tenancies: paid on or before the due date, paid late, and still unpaid past the due date. */
  payments: { onTime: number; late: number; overdue: number }
}

/**
 * "Profil penyewa" for the owner of the kos. The kos check is the ownerProcedure guard; the application or tenancy must belong
 * to that kos, so an owner cannot read a stranger by guessing a user id. What the student has not shared stays hidden, and
 * the emergency contact is released only after acceptance. Every call writes an audit row.
 */
export interface OwnerNotificationRow {
  id: string
  at: string
  kind: string
  channel: string
  recipient: string
  status: string
  roomNumber: string
  tenantName: string
}

export const ownerTenantRouter = router({
  /** What KoBo sent about payments in this kos: the last 40 reminder decisions, newest first. Owner-visible log (item 2). */
  notifications: ownerProcedure.input(z.object({ kosId: z.string().min(1).max(64) })).query(async ({ ctx, input }): Promise<OwnerNotificationRow[]> => {
    const rows = await ctx.prisma.notificationLog.findMany({
      where: { invoice: { tenancy: { room: { kosId: input.kosId } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 40,
      include: { invoice: { select: { tenancy: { select: { room: { select: { roomNumber: true } }, user: { select: { name: true } } } } } } },
    })
    return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), kind: r.kind, channel: r.channel, recipient: r.recipient, status: r.status, roomNumber: r.invoice.tenancy.room.roomNumber, tenantName: r.invoice.tenancy.user.name }))
  }),

  tenantProfile: ownerProcedure.input(tenantProfileInput).query(async ({ ctx, input }): Promise<TenantProfile> => {
    let userId: string
    let basis: TenantProfile['basis']
    let accepted: boolean
    if (input.applicationId) {
      const a = await ctx.prisma.rentalApplication.findFirst({ where: { id: input.applicationId, room: { kosId: input.kosId } }, select: { userId: true, status: true } })
      if (!a) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pengajuan tidak ditemukan.' })
      userId = a.userId
      basis = 'APPLICATION'
      accepted = a.status === 'APPROVED'
    } else {
      const t = await ctx.prisma.tenancy.findFirst({ where: { id: input.tenancyId, room: { kosId: input.kosId } }, select: { userId: true } })
      if (!t) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sewa tidak ditemukan.' })
      userId = t.userId
      basis = 'TENANCY'
      accepted = true
    }

    const u = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        name: true, campus: true, phone: true, campusEmailVerifiedAt: true,
        emergencyContactName: true, emergencyContactRelation: true, emergencyContactPhone: true, emergencyContactConsentAt: true,
      },
    })
    const [reviews, invoices] = await Promise.all([
      ctx.prisma.review.findMany({ where: { tenancy: { userId } }, select: { rating: true } }),
      ctx.prisma.invoice.findMany({
        where: { tenancy: { userId } },
        select: { status: true, dueDate: true, payments: { where: { status: 'PAID' }, select: { paidAt: true }, orderBy: { paidAt: 'asc' }, take: 1 } },
      }),
    ])
    const today = todayWIB(new Date())
    const payments = { onTime: 0, late: 0, overdue: 0 }
    for (const inv of invoices) {
      const due = inv.dueDate.toISOString().slice(0, 10)
      if (inv.status === 'PAID') {
        const paidAt = inv.payments[0]?.paidAt
        if (paidAt && compareDates(todayWIB(paidAt), due) > 0) payments.late += 1
        else payments.onTime += 1
      } else if (compareDates(today, due) > 0) {
        payments.overdue += 1
      }
    }

    await ctx.prisma.tenantProfileView.create({ data: { ownerUserId: ctx.user.id, tenantUserId: userId, kosId: input.kosId } })

    const hasContact = u.emergencyContactName && u.emergencyContactPhone && u.emergencyContactConsentAt
    return {
      name: u.name,
      campus: u.campus,
      campusVerified: u.campusEmailVerifiedAt !== null,
      phone: accepted ? u.phone : null,
      basis,
      accepted,
      emergencyContact: accepted && hasContact ? { name: u.emergencyContactName!, relation: u.emergencyContactRelation ?? '', phone: u.emergencyContactPhone! } : null,
      reviews: { count: reviews.length, averageGiven: reviews.length ? Math.round((reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) * 10) / 10 : null },
      payments,
    }
  }),
})
