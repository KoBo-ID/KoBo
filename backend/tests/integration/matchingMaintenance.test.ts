import { beforeEach, describe, expect, it } from 'vitest'
import { runMatchingMaintenance } from '../../src/matching/maintenance.ts'
import { renderEmail } from '../../src/emailTemplates.ts'
import { resetDb } from '../../src/db/seed.ts'
import { prisma } from '../helpers.ts'

// The clock is pinned to a fixed instant; every fixture is placed relative to it.
const NOW = new Date('2027-03-10T10:00:00Z')
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const at = (ms: number) => new Date(NOW.getTime() + ms)

let seq = 0
async function mk(o: { verified?: boolean; optOut?: boolean; notifyOptOut?: boolean; demo?: boolean; name?: string } = {}) {
  const n = ++seq
  const user = await prisma.user.create({
    data: {
      id: `mm-user-${n}`,
      name: o.name ?? `Mhs ${n}`,
      email: `mm-${n}@kobo.test`,
      emailVerified: true,
      isDemo: o.demo ?? false,
      notifyOptOut: o.notifyOptOut ?? false,
      campusEmailVerifiedAt: o.verified === false ? null : at(-30 * DAY),
      campusVerifiedUntil: o.verified === false ? null : at(300 * DAY),
    },
  })
  await prisma.matchingProfile.create({
    data: {
      userId: user.id,
      displayName: o.name ?? `Teman ${n}`,
      gender: 'LAKI_LAKI',
      birthYear: 2002,
      active: true,
      emailOptOut: o.optOut ?? false,
      lastActiveAt: NOW,
      budgetMin: 1_000_000,
      budgetMax: 2_000_000,
      anchorLat: -6.2,
      anchorLng: 106.8,
      anchorLabel: 'Kampus',
      moveInDate: new Date('2027-04-01'),
      smoking: 'BEBAS',
    },
  })
  return user
}

async function request(from: { id: string }, to: { id: string }, over: { status?: 'PENDING' | 'ACCEPTED'; expiresAt?: Date } = {}) {
  return prisma.partnerRequest.create({ data: { fromUserId: from.id, toUserId: to.id, status: over.status ?? 'PENDING', expiresAt: over.expiresAt ?? at(10 * DAY), createdAt: at(-1 * DAY) } })
}

async function connect(x: { id: string }, y: { id: string }, over: { endedAt?: Date; createdAt?: Date } = {}) {
  const req = await request(x, y, { status: 'ACCEPTED' })
  const [a, b] = x.id < y.id ? [x.id, y.id] : [y.id, x.id]
  return prisma.partnerConnection.create({
    data: { userAId: a, userBId: b, requestId: req.id, createdAt: over.createdAt ?? at(-10 * DAY), endedAt: over.endedAt ?? null, endedById: over.endedAt ? a : null, endReason: over.endedAt ? 'ENDED_BY_USER' : null },
  })
}

const say = (connectionId: string, senderId: string, ageMs: number, body = 'rahasia 081234567890') =>
  prisma.partnerMessage.create({ data: { connectionId, senderId, body, createdAt: at(-ageMs) } })

const digests = () => prisma.emailOutbox.findMany({ where: { template: 'matching-digest' }, orderBy: { createdAt: 'asc' } })

beforeEach(async () => {
  await resetDb(prisma)
  await prisma.emailOutbox.deleteMany({})
  // The pinned clock is months after the seed, so the seeded demo request and chat would count as expired/unread. Start clean.
  await prisma.partnerConnection.deleteMany({})
  await prisma.partnerRequest.deleteMany({})
})

describe('runMatchingMaintenance: requests', () => {
  it('expires PENDING requests past expiresAt and leaves the others', async () => {
    const [a, b, c] = [await mk(), await mk(), await mk()]
    const old = await request(a, b, { expiresAt: at(-1 * MIN) })
    const live = await request(a, c, { expiresAt: at(1 * HOUR) })
    const res = await runMatchingMaintenance(prisma, NOW)
    expect(res.expired).toBe(1)
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('EXPIRED')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: live.id } })).status).toBe('PENDING')
  })

  it('cancels PENDING requests when either side is no longer a verified student, but not for demo users or verified pairs', async () => {
    const ok1 = await mk()
    const ok2 = await mk()
    const lapsed = await mk({ verified: false })
    const demo = await mk({ verified: false, demo: true })
    const expiredLink = await mk()
    await prisma.user.update({ where: { id: expiredLink.id }, data: { campusVerifiedUntil: at(-1 * DAY) } })
    const fine = await request(ok1, ok2)
    const fromLapsed = await request(lapsed, ok1)
    const toLapsed = await request(ok2, lapsed)
    const viaDemo = await request(demo, ok2)
    const viaExpired = await request(ok1, expiredLink)
    const res = await runMatchingMaintenance(prisma, NOW)
    const status = async (id: string) => (await prisma.partnerRequest.findUniqueOrThrow({ where: { id } })).status
    expect(await status(fine.id)).toBe('PENDING')
    expect(await status(viaDemo.id)).toBe('PENDING')
    expect(await status(fromLapsed.id)).toBe('CANCELLED')
    expect(await status(toLapsed.id)).toBe('CANCELLED')
    expect(await status(viaExpired.id)).toBe('CANCELLED')
    expect(res.cancelled).toBe(3)
  })

  it('does not touch already decided requests', async () => {
    const [a, b] = [await mk({ verified: false }), await mk()]
    const done = await request(a, b, { status: 'ACCEPTED' })
    await runMatchingMaintenance(prisma, NOW)
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: done.id } })).status).toBe('ACCEPTED')
  })
})

describe('runMatchingMaintenance: digest', () => {
  it('sends one digest with the sender name and no message text, then not again within 6 h', async () => {
    const a = await mk({ name: 'Andi' })
    const b = await mk({ name: 'Budi' })
    const conn = await connect(a, b)
    await say(conn.id, a.id, 30 * MIN)
    const first = await runMatchingMaintenance(prisma, NOW)
    expect(first.digests).toBe(1)
    const [row] = await digests()
    expect(row!.to).toBe(b.email)
    expect(row!.payload).toMatchObject({ from: 'Andi', url: expect.stringContaining(`/teman-sekamar/pesan/${conn.id}`) })
    expect(JSON.stringify(row!.payload)).not.toContain('rahasia')
    expect(JSON.stringify(row!.payload)).not.toContain(a.email)
    const mail = renderEmail('matching-digest', row!.payload)!
    expect(mail.subject).toContain('Ada pesan baru dari Andi')
    expect(mail.text + mail.html).not.toContain('rahasia')

    // A newer message arrives; at +5 h 30 min the 6 h window since the first digest is still open, at +6 h 1 min it is not.
    await prisma.partnerMessage.create({ data: { connectionId: conn.id, senderId: a.id, body: 'lagi', createdAt: at(1 * HOUR) } })
    expect((await runMatchingMaintenance(prisma, at(5 * HOUR + 30 * MIN))).digests).toBe(0)
    expect((await runMatchingMaintenance(prisma, at(6 * HOUR + 1 * MIN))).digests).toBe(1)
    expect(await digests()).toHaveLength(2)
  })

  it('waits until a message is 15 minutes old', async () => {
    const [a, b] = [await mk(), await mk()]
    const conn = await connect(a, b)
    await say(conn.id, a.id, 10 * MIN)
    expect((await runMatchingMaintenance(prisma, NOW)).digests).toBe(0)
    expect((await runMatchingMaintenance(prisma, at(6 * MIN))).digests).toBe(1)
  })

  it('does not mail about messages already read', async () => {
    const [a, b] = [await mk(), await mk()]
    const conn = await connect(a, b)
    await say(conn.id, a.id, 2 * HOUR)
    await prisma.connectionReadState.create({ data: { connectionId: conn.id, userId: b.id, lastReadAt: at(-1 * HOUR) } })
    expect((await runMatchingMaintenance(prisma, NOW)).digests).toBe(0)
  })

  it('mails each side that has something unread', async () => {
    const [a, b] = [await mk(), await mk()]
    const conn = await connect(a, b)
    await say(conn.id, a.id, 2 * HOUR)
    await say(conn.id, b.id, 90 * MIN)
    expect((await runMatchingMaintenance(prisma, NOW)).digests).toBe(2)
    expect((await digests()).map((d) => d.to).sort()).toEqual([a.email, b.email].sort())
  })

  it('an ignored thread is not re-mailed every 6 h: only a newer unread message triggers the next digest', async () => {
    const [a, b] = [await mk(), await mk()]
    const conn = await connect(a, b)
    await say(conn.id, a.id, 1 * HOUR)
    expect((await runMatchingMaintenance(prisma, NOW)).digests).toBe(1)
    expect((await runMatchingMaintenance(prisma, at(7 * HOUR))).digests).toBe(0)
    await prisma.partnerMessage.create({ data: { connectionId: conn.id, senderId: a.id, body: 'x', createdAt: at(8 * HOUR) } })
    expect((await runMatchingMaintenance(prisma, at(9 * HOUR))).digests).toBe(1)
  })

  it('respects the matching email opt-out and the account-wide notification opt-out', async () => {
    const sender = await mk()
    const optOut = await mk({ optOut: true })
    const notify = await mk({ notifyOptOut: true })
    for (const r of [optOut, notify]) {
      const conn = await connect(sender, r)
      await say(conn.id, sender.id, 1 * HOUR)
    }
    const res = await runMatchingMaintenance(prisma, NOW)
    expect(res.digests).toBe(0)
    expect(await digests()).toHaveLength(0)
  })

  it('ignores ended connections', async () => {
    const [a, b] = [await mk(), await mk()]
    const conn = await connect(a, b, { endedAt: at(-1 * DAY) })
    await say(conn.id, a.id, 2 * DAY)
    expect((await runMatchingMaintenance(prisma, NOW)).digests).toBe(0)
  })

  it('creating the read state for a never-opened chat does not mark old messages read', async () => {
    const [a, b] = [await mk(), await mk()]
    const conn = await connect(a, b)
    await say(conn.id, a.id, 3 * HOUR)
    await runMatchingMaintenance(prisma, NOW)
    const state = await prisma.connectionReadState.findUniqueOrThrow({ where: { connectionId_userId: { connectionId: conn.id, userId: b.id } } })
    expect(state.lastDigestAt?.toISOString()).toBe(NOW.toISOString())
    expect(state.lastReadAt.getTime()).toBeLessThan(NOW.getTime() - 3 * HOUR)
  })
})

describe('runMatchingMaintenance: purge', () => {
  it('deletes messages 90 days after the connection ended, keeps younger ones and live chats', async () => {
    const [a, b, c, d] = [await mk(), await mk(), await mk(), await mk()]
    const old = await connect(a, b, { endedAt: at(-91 * DAY) })
    const recent = await connect(a, c, { endedAt: at(-89 * DAY) })
    const live = await connect(b, d)
    for (const conn of [old, recent, live]) await say(conn.id, conn.userAId, 100 * DAY)
    const res = await runMatchingMaintenance(prisma, NOW)
    expect(res.purged).toBe(1)
    expect(await prisma.partnerMessage.count({ where: { connectionId: old.id } })).toBe(0)
    expect(await prisma.partnerMessage.count({ where: { connectionId: recent.id } })).toBe(1)
    expect(await prisma.partnerMessage.count({ where: { connectionId: live.id } })).toBe(1)
    // The connection row itself stays (it is the audit trail for reports and the frozen shortlist).
    expect(await prisma.partnerConnection.count({ where: { id: old.id } })).toBe(1)
  })

  it('returns all-zero counts on an idle database', async () => {
    expect(await runMatchingMaintenance(prisma, NOW)).toEqual({ expired: 0, cancelled: 0, digests: 0, purged: 0 })
  })
})

describe('matching email templates', () => {
  it.each(['matching-request', 'matching-accept'])('%s renders Indonesian copy with a link', (t) => {
    const mail = renderEmail(t, { name: 'Budi', url: 'https://kobo.test/teman-sekamar/permintaan' })!
    expect(mail.subject).toMatch(/teman sekamar/i)
    expect(mail.text).toContain('https://kobo.test/teman-sekamar/permintaan')
    expect(mail.text).toContain('Halo Budi')
  })
  it('the request mail says there is a new request', () => {
    expect(renderEmail('matching-request', { name: 'Budi', url: 'https://x.test/a' })!.subject).toContain('Ada permintaan teman sekamar baru')
  })
  it('the digest falls back to a generic sender and returns null without a url', () => {
    expect(renderEmail('matching-digest', { name: 'B', url: 'https://x.test/a' })!.subject).toContain('Ada pesan baru dari')
    expect(renderEmail('matching-digest', { name: 'B' })).toBeNull()
  })
})
