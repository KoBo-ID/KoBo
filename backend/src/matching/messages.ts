// Partner chat: participants only, live connections only for writing, contact-info confirmation, unread counts.
import { containsContactInfo } from '@kobo/shared/domain'
import type { MatchingUnread, PartnerMessagePage, PartnerMessageSendResult, PartnerMessageView } from '@kobo/shared/types'
import { TRPCError } from '@trpc/server'
import type { PartnerConnection } from '../generated/prisma/client.ts'
import { isBlockedEither } from './eligibility.ts'
import { touchActive, type Db } from './profiles.ts'

export const DELETED_PARTNER_NAME = 'Pengguna KoBo'
export const MESSAGE_PAGE_SIZE = 30

/** The caller's connection (live or ended), or null when it does not exist or the caller is not a participant. */
export async function loadMyConnection(db: Db, userId: string, connectionId: string): Promise<PartnerConnection | null> {
  return db.partnerConnection.findFirst({ where: { id: connectionId, OR: [{ userAId: userId }, { userBId: userId }] } })
}

export const requireMyConnection = async (db: Db, userId: string, connectionId: string): Promise<PartnerConnection> => {
  const c = await loadMyConnection(db, userId, connectionId)
  if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Koneksi tidak ditemukan.' })
  return c
}

export const partnerUserId = (c: Pick<PartnerConnection, 'userAId' | 'userBId'>, me: string): string => (c.userAId === me ? c.userBId : c.userAId)

/** The partner's display name, or "Pengguna KoBo" once the profile is gone. */
export async function partnerName(db: Db, userId: string): Promise<string> {
  const p = await db.matchingProfile.findUnique({ where: { userId }, select: { displayName: true } })
  return p?.displayName ?? DELETED_PARTNER_NAME
}

const encodeCursor = (m: { createdAt: Date; id: string }): string => `${m.createdAt.toISOString()}|${m.id}`
function decodeCursor(s: string): { createdAt: Date; id: string } | null {
  const [iso, id] = s.split('|')
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime()) || !id) return null
  return { createdAt: d, id }
}

const toView = (m: { id: string; senderId: string; body: string; createdAt: Date }, me: string): PartnerMessageView => ({
  id: m.id,
  mine: m.senderId === me,
  body: m.body,
  createdAt: m.createdAt.toISOString(),
})

/** Writing is possible only on a live connection where neither side blocked the other. */
async function canWrite(db: Db, c: PartnerConnection): Promise<boolean> {
  return c.endedAt === null && !(await isBlockedEither(db, c.userAId, c.userBId))
}

/** Newest-first paging by (createdAt, id); the page itself is returned oldest first. Read-only connections can still be read. */
export async function listMessages(db: Db, me: string, input: { connectionId: string; cursor?: string; limit?: number }): Promise<PartnerMessagePage> {
  const conn = await requireMyConnection(db, me, input.connectionId)
  const size = Math.min(input.limit ?? MESSAGE_PAGE_SIZE, MESSAGE_PAGE_SIZE)
  let cursorWhere = {}
  if (input.cursor) {
    const c = decodeCursor(input.cursor)
    if (!c) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Penanda halaman tidak valid.' })
    cursorWhere = { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] }
  }
  const rows = await db.partnerMessage.findMany({
    where: { connectionId: conn.id, ...cursorWhere },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: size + 1,
    select: { id: true, senderId: true, body: true, createdAt: true },
  })
  const page = rows.slice(0, size)
  const nextCursor = rows.length > size ? encodeCursor(page[page.length - 1]!) : null
  return { items: page.reverse().map((m) => toView(m, me)), nextCursor, canSend: await canWrite(db, conn) }
}

export async function sendMessage(db: Db, me: string, input: { connectionId: string; body: string; confirmContact?: boolean }, now = new Date()): Promise<PartnerMessageSendResult> {
  const conn = await requireMyConnection(db, me, input.connectionId)
  if (conn.endedAt !== null) throw new TRPCError({ code: 'FORBIDDEN', message: 'Koneksi ini sudah berakhir, jadi pesan tidak bisa dikirim.' })
  if (await isBlockedEither(db, conn.userAId, conn.userBId)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Pesan tidak bisa dikirim ke pengguna ini.' })
  const body = input.body.trim()
  if (body.length === 0 || body.length > 1000) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pesan harus 1 sampai 1000 karakter.' })
  const hadContact = containsContactInfo(body)
  if (hadContact && input.confirmContact !== true) return { sent: false, needsConfirm: true }
  const m = await db.partnerMessage.create({ data: { connectionId: conn.id, senderId: me, body, hadContact, createdAt: now } })
  await touchActive(db, me, now)
  return { sent: true, message: toView(m, me) }
}

export async function markRead(db: Db, me: string, connectionId: string, now = new Date()): Promise<{ ok: true }> {
  const conn = await requireMyConnection(db, me, connectionId)
  await db.connectionReadState.upsert({
    where: { connectionId_userId: { connectionId: conn.id, userId: me } },
    create: { connectionId: conn.id, userId: me, lastReadAt: now },
    update: { lastReadAt: now },
  })
  return { ok: true }
}

/** Unread partner messages per connection id (connections with none are absent). Counts live connections only unless `includeEnded`. */
export async function unreadByConnection(db: Db, me: string, opts: { includeEnded?: boolean } = {}): Promise<Map<string, number>> {
  const conns = await db.partnerConnection.findMany({
    where: { OR: [{ userAId: me }, { userBId: me }], ...(opts.includeEnded ? {} : { endedAt: null }) },
    select: { id: true, readStates: { where: { userId: me }, select: { lastReadAt: true } } },
  })
  const out = new Map<string, number>()
  await Promise.all(
    conns.map(async (c) => {
      const lastReadAt = c.readStates[0]?.lastReadAt
      const n = await db.partnerMessage.count({ where: { connectionId: c.id, senderId: { not: me }, ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}) } })
      if (n > 0) out.set(c.id, n)
    }),
  )
  return out
}

export async function unreadCount(db: Db, me: string, now = new Date()): Promise<MatchingUnread & { perConnection: Record<string, number> }> {
  const per = await unreadByConnection(db, me)
  const requests = await db.partnerRequest.count({ where: { toUserId: me, status: 'PENDING', expiresAt: { gt: now } } })
  return { messages: [...per.values()].reduce((a, b) => a + b, 0), requests, perConnection: Object.fromEntries(per) }
}
