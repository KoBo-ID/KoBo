import { TRPCError } from '@trpc/server'
import type { PrismaClient } from './db/client.ts'

/*
 * The public demo accounts are shared by everyone who presses "Masuk cepat". When real money and real people use the
 * same marketplace, the two worlds must not mix:
 *  - a real account never applies to, queues for or books a survey at a kos owned by the shared demo owner (every demo
 *    visitor can read the demo owner's applicants);
 *  - a demo account never does it at a kos owned by a real, signed-up owner (the MOCK provider would let the demo account
 *    "pay" without any real payment and activate a tenancy in the real owner's room).
 * Seeded showcase owners have no login (no Account row), so the demo student may still use them. Opt-in: set
 * DEMO_ISOLATION=1 in production; dev, e2e and tests keep the open behavior.
 */
export const demoIsolationOn = (env: NodeJS.ProcessEnv = process.env) => env.DEMO_ISOLATION === '1'

export async function assertDemoIsolation(db: Pick<PrismaClient, 'kos'>, user: { isDemo?: boolean }, kosId: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!demoIsolationOn(env)) return
  const kos = await db.kos.findUnique({
    where: { id: kosId },
    select: { owner: { select: { user: { select: { isDemo: true, accounts: { select: { id: true }, take: 1 } } } } } },
  })
  const owner = kos?.owner.user
  if (!owner) return
  const userIsDemo = user.isDemo === true
  if (!userIsDemo && owner.isDemo) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Kos ini adalah kos contoh untuk akun demo. Pilih kos lain.' })
  }
  if (userIsDemo && !owner.isDemo && owner.accounts.length > 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Akun demo hanya dapat dipakai pada kos contoh, bukan kos milik pengguna sungguhan.' })
  }
}
