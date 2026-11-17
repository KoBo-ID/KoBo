import { TRPCError } from '@trpc/server'
import { TERMS_VERSION } from '@kobo/shared/domain'
import type { PrismaClient } from './db/client.ts'

/**
 * Whether a first application needs an emergency contact (with consent) and the current Syarat version. On in production
 * unless REQUIRE_PROFILE_CONSENTS=0; off elsewhere unless REQUIRE_PROFILE_CONSENTS=1 (tests turn it on explicitly).
 */
export function consentsRequired(): boolean {
  const flag = process.env.REQUIRE_PROFILE_CONSENTS
  if (flag === '1') return true
  if (flag === '0') return false
  return process.env.NODE_ENV === 'production'
}

/** Demo accounts are exempt; everyone else must have an emergency contact with consent and the current terms before applying. */
export async function assertApplicationConsents(prisma: Pick<PrismaClient, 'user'>, userId: string): Promise<void> {
  if (!consentsRequired()) return
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { isDemo: true, emergencyContactName: true, emergencyContactPhone: true, emergencyContactConsentAt: true, termsVersion: true },
  })
  if (!u || u.isDemo) return
  if (!u.emergencyContactName || !u.emergencyContactPhone || !u.emergencyContactConsentAt) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Lengkapi kontak darurat Anda di halaman Profil sebelum mengajukan sewa.' })
  }
  if (u.termsVersion !== TERMS_VERSION) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Setujui Syarat Penggunaan dan Kebijakan Privasi terbaru sebelum mengajukan sewa.' })
  }
}
