import { Cron } from 'croner'
import { isStudentVerified } from '@kobo/shared/domain'
import type { PrismaClient } from '../db/client.ts'
import { beat, registerWorker } from '../health.ts'
import { expireRequests } from './requests.ts'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
/** A message must sit unread this long before it can trigger a digest (the chat is open and polled meanwhile). */
export const DIGEST_MIN_AGE_MS = 15 * MIN
/** At most one digest per recipient per connection in this window. */
export const DIGEST_GAP_MS = 6 * HOUR
/** Messages of a connection are deleted this many days after it ended (UU PDP minimisation, decision Q2). */
export const MESSAGE_RETENTION_DAYS = 90

export interface MatchingMaintenanceResult {
  expired: number
  cancelled: number
  digests: number
  purged: number
}

const originUrl = () => (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')

/** Cancels PENDING requests where either side lost student verification (demo accounts are exempt). */
async function cancelUnverified(prisma: PrismaClient, now: Date): Promise<number> {
  const pending = await prisma.partnerRequest.findMany({
    where: { status: 'PENDING' },
    select: {
      id: true,
      from: { select: { isDemo: true, campusEmailVerifiedAt: true, campusVerifiedUntil: true } },
      to: { select: { isDemo: true, campusEmailVerifiedAt: true, campusVerifiedUntil: true } },
    },
  })
  const ok = (u: { isDemo: boolean; campusEmailVerifiedAt: Date | null; campusVerifiedUntil: Date | null }) => u.isDemo || isStudentVerified(u, now)
  const ids = pending.filter((r) => !ok(r.from) || !ok(r.to)).map((r) => r.id)
  if (!ids.length) return 0
  const res = await prisma.partnerRequest.updateMany({ where: { id: { in: ids }, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: now } })
  return res.count
}

/**
 * One digest email per recipient per live connection per 6 h, only while the recipient has an unread message older than
 * 15 min that arrived after the previous digest (so an ignored thread does not mail every 6 h forever). No message text, no
 * contact: just the sender's display name and a link. Tracked in ConnectionReadState.lastDigestAt. Respects both opt-outs.
 */
async function sendDigests(prisma: PrismaClient, now: Date): Promise<number> {
  const conns = await prisma.partnerConnection.findMany({
    where: { endedAt: null, messages: { some: { createdAt: { lte: new Date(now.getTime() - DIGEST_MIN_AGE_MS) } } } },
    select: {
      id: true,
      createdAt: true,
      userAId: true,
      userBId: true,
      readStates: { select: { userId: true, lastReadAt: true, lastDigestAt: true } },
    },
  })
  let sent = 0
  for (const c of conns) {
    for (const [me, other] of [[c.userAId, c.userBId], [c.userBId, c.userAId]] as const) {
      const state = c.readStates.find((s) => s.userId === me)
      const lastRead = state?.lastReadAt ?? c.createdAt
      const lastDigest = state?.lastDigestAt ?? null
      if (lastDigest && now.getTime() - lastDigest.getTime() < DIGEST_GAP_MS) continue
      const unread = await prisma.partnerMessage.findMany({
        where: { connectionId: c.id, senderId: other, createdAt: { gt: lastRead, lte: new Date(now.getTime() - DIGEST_MIN_AGE_MS) } },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      })
      if (!unread.length) continue
      if (lastDigest && unread[0].createdAt <= lastDigest) continue
      const [recipient, sender] = await Promise.all([
        prisma.user.findUnique({ where: { id: me }, select: { email: true, name: true, notifyOptOut: true, matchingProfile: { select: { emailOptOut: true } } } }),
        prisma.matchingProfile.findUnique({ where: { userId: other }, select: { displayName: true } }),
      ])
      if (!recipient || recipient.notifyOptOut || recipient.matchingProfile?.emailOptOut) continue
      await prisma.$transaction([
        prisma.connectionReadState.upsert({
          where: { connectionId_userId: { connectionId: c.id, userId: me } },
          create: { connectionId: c.id, userId: me, lastReadAt: lastRead, lastDigestAt: now },
          update: { lastDigestAt: now },
        }),
        prisma.emailOutbox.create({
          data: {
            to: recipient.email,
            template: 'matching-digest',
            payload: { name: recipient.name, from: sender?.displayName ?? 'Teman sekamar', url: `${originUrl()}/teman-sekamar/pesan/${c.id}` },
          },
        }),
      ])
      sent++
    }
  }
  return sent
}

/** Deletes the messages of connections that ended more than 90 days ago. The connection row (and its shortlist) stays. */
async function purgeMessages(prisma: PrismaClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - MESSAGE_RETENTION_DAYS * DAY)
  const res = await prisma.partnerMessage.deleteMany({ where: { connection: { endedAt: { lt: cutoff } } } })
  return res.count
}

export async function runMatchingMaintenance(prisma: PrismaClient, now: Date): Promise<MatchingMaintenanceResult> {
  const expired = await expireRequests(prisma, now)
  const cancelled = await cancelUnverified(prisma, now)
  const digests = await sendDigests(prisma, now)
  const purged = await purgeMessages(prisma, now)
  return { expired, cancelled, digests, purged }
}

/** Every hour at :17 Jakarta time. Started from index.ts only (tests call runMatchingMaintenance directly). */
export const MATCHING_MAINTENANCE_CRON = '17 * * * *'
const HOURLY_STALE_MS = 3 * HOUR + 30 * MIN

export function startMatchingMaintenance(prisma: PrismaClient): () => void {
  registerWorker('matching-maintenance', HOURLY_STALE_MS)
  const job = new Cron(MATCHING_MAINTENANCE_CRON, { timezone: 'Asia/Jakarta', protect: true }, async () => {
    try {
      const r = await runMatchingMaintenance(prisma, new Date())
      console.log(`[matching] maintenance: ${r.expired} expired, ${r.cancelled} cancelled, ${r.digests} digest(s), ${r.purged} message(s) purged`)
      beat('matching-maintenance')
    } catch (err) {
      console.error('[matching] maintenance failed:', err instanceof Error ? err.message : err)
    }
  })
  return () => job.stop()
}
