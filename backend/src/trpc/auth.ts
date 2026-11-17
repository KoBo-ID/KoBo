import { TRPCError } from '@trpc/server'
import { consentsRequired } from '../consents.ts'
import { TERMS_VERSION } from '@kobo/shared/domain'
import { acceptTermsInput, emergencyContactInput, notifyPrefInput, profileUpdateInput } from '@kobo/shared/schemas'
import { authedProcedure, publicProcedure, router } from './trpc.ts'

export interface MeResult {
  user: { id: string; name: string; email: string; image: string | null; phone: string | null; campus: string | null; campusEmail: string | null; isDemo: boolean }
  /** "Is owner" is exactly `ownerProfile != null` (spec section 3). */
  isOwner: boolean
  ownerProfileId: string | null
  /** False while a newly registered owner waits for KoBo's approval; their kos are not public yet. Null for non-owners. */
  ownerApproved: boolean | null
  campusVerified: boolean
  /** The caller's own emergency contact (null until filled in with consent). */
  emergencyContact: { name: string; relation: string; phone: string } | null
  /** True when the caller agreed to the current Syarat/Privasi version. */
  termsCurrent: boolean
  termsVersion: string
  /** True when a first application needs the emergency contact and the current terms (production default). */
  profileConsentsRequired: boolean
  notifyOptOut: boolean
}

export interface ProvidersResult {
  google: boolean
}

export const authRouter = router({
  /** Which social sign-in buttons the UI may show. Booleans only, never client ids or secrets. */
  providers: publicProcedure.query(({ ctx }): ProvidersResult => ({ google: Boolean(ctx.auth.options.socialProviders?.google) })),

  /** The signed-in user, or null. The frontend derives persona and route guards from this. */
  me: publicProcedure.query(async ({ ctx }): Promise<MeResult | null> => {
    const session = await ctx.getSession()
    if (!session) return null
    const u = await ctx.prisma.user.findUnique({ where: { id: session.user.id }, include: { ownerProfile: { select: { id: true, approvedAt: true } } } })
    if (!u) return null
    return {
      user: { id: u.id, name: u.name, email: u.email, image: u.image, phone: u.phone, campus: u.campus, campusEmail: u.campusEmail, isDemo: u.isDemo },
      isOwner: u.ownerProfile !== null,
      ownerProfileId: u.ownerProfile?.id ?? null,
      ownerApproved: u.ownerProfile ? u.ownerProfile.approvedAt !== null : null,
      campusVerified: u.campusEmailVerifiedAt !== null,
      emergencyContact: u.emergencyContactName && u.emergencyContactPhone && u.emergencyContactConsentAt
        ? { name: u.emergencyContactName, relation: u.emergencyContactRelation ?? '', phone: u.emergencyContactPhone }
        : null,
      termsCurrent: u.termsVersion === TERMS_VERSION,
      termsVersion: TERMS_VERSION,
      profileConsentsRequired: consentsRequired() && !u.isDemo,
      notifyOptOut: u.notifyOptOut,
    }
  }),

  /** Name, WhatsApp number and campus of the caller. Email and password never change here (demo guard). */
  updateProfile: authedProcedure.input(profileUpdateInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    await ctx.prisma.user.update({ where: { id: ctx.user.id }, data: { name: input.name, phone: input.phone, campus: input.campus || null } })
    return { id: ctx.user.id }
  }),

  /** Emergency contact, stored only together with the student's consent that KoBo may message them about an overdue payment. */
  updateEmergencyContact: authedProcedure.input(emergencyContactInput).mutation(async ({ ctx, input }): Promise<{ id: string }> => {
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { isDemo: true } })
    if (u.isDemo) throw new TRPCError({ code: 'FORBIDDEN', message: 'Akun demo bersifat hanya-baca dan tidak dapat menyimpan kontak darurat.' })
    await ctx.prisma.user.update({
      where: { id: ctx.user.id },
      data: { emergencyContactName: input.name, emergencyContactRelation: input.relation, emergencyContactPhone: input.phone, emergencyContactConsentAt: new Date() },
    })
    return { id: ctx.user.id }
  }),

  /** Withdraws the contact and the consent together. */
  clearEmergencyContact: authedProcedure.mutation(async ({ ctx }): Promise<{ id: string }> => {
    await ctx.prisma.user.update({
      where: { id: ctx.user.id },
      data: { emergencyContactName: null, emergencyContactRelation: null, emergencyContactPhone: null, emergencyContactConsentAt: null },
    })
    return { id: ctx.user.id }
  }),

  /** Records agreement to the Syarat/Privasi version shown. A stale version is refused so a cached page cannot consent to old text. */
  acceptTerms: authedProcedure.input(acceptTermsInput).mutation(async ({ ctx, input }): Promise<{ version: string }> => {
    if (input.version !== TERMS_VERSION) throw new TRPCError({ code: 'CONFLICT', message: 'Syarat telah diperbarui. Muat ulang halaman lalu baca versi terbaru.' })
    await ctx.prisma.user.update({ where: { id: ctx.user.id }, data: { termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() } })
    return { version: TERMS_VERSION }
  }),

  /** Payment reminders to the student themselves (email / WhatsApp). The owner still sees the invoice; the emergency contact flow is separate. */
  setNotifyOptOut: authedProcedure.input(notifyPrefInput).mutation(async ({ ctx, input }): Promise<{ optOut: boolean }> => {
    await ctx.prisma.user.update({ where: { id: ctx.user.id }, data: { notifyOptOut: input.optOut } })
    return { optOut: input.optOut }
  }),
})
