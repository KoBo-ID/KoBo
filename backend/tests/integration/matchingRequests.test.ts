import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { acceptRequest, cancelRequest, declineRequest, endConnection, expireRequests, listConnections, listRequests, sendRequest } from '../../src/matching/requests.ts'
import { callerFor, prisma } from '../helpers.ts'
import { err } from './gap-helpers.ts'

// The clock is pinned: core functions take `now`. tRPC calls use the real clock, so fixtures sit around the real "now" taken once here.
const NOW = new Date()
const DAY = 86_400_000
const at = (days: number) => new Date(NOW.getTime() + days * DAY)

let seq = 0
interface Opts {
  gender?: 'LAKI_LAKI' | 'PEREMPUAN'
  active?: boolean
  paused?: boolean
  ageDays?: number
  optOut?: boolean
  verified?: boolean
  name?: string
}
/** A verified student with a matching profile (old enough to send by default). Returns ids. */
async function mk(o: Opts = {}) {
  const n = ++seq
  const user = await prisma.user.create({
    data: {
      id: `mt-user-${n}`,
      name: `Mhs ${n}`,
      email: `mt-${n}@kobo.test`,
      emailVerified: true,
      campusEmailVerifiedAt: o.verified === false ? null : at(-30),
    },
  })
  const profile = await prisma.matchingProfile.create({
    data: {
      userId: user.id,
      displayName: o.name ?? `Teman ${n}`,
      gender: o.gender ?? 'LAKI_LAKI',
      birthYear: 1999,
      active: o.active ?? true,
      pausedAt: o.paused ? at(-1) : null,
      emailOptOut: o.optOut ?? false,
      createdAt: at(-(o.ageDays ?? 3)),
      lastActiveAt: NOW,
      budgetMin: 1_000_000,
      budgetMax: 2_000_000,
      anchorLat: -6.2,
      anchorLng: 106.8,
      anchorLabel: 'Kampus',
      moveInDate: new Date('2026-12-15'),
      smoking: 'BEBAS',
    },
  })
  return { id: user.id, pid: profile.id }
}

const send = (from: { id: string }, to: { pid: string }, message?: string, now = NOW) => sendRequest(prisma, from.id, { profileId: to.pid, message }, now)
const code = async (p: Promise<unknown>) => (await err(p))?.code

async function pending(from: { id: string }, to: { id: string }, over: { createdAt?: Date; expiresAt?: Date; status?: 'PENDING' | 'DECLINED' | 'CANCELLED' | 'EXPIRED' | 'ACCEPTED'; decidedAt?: Date } = {}) {
  return prisma.partnerRequest.create({
    data: { fromUserId: from.id, toUserId: to.id, createdAt: over.createdAt ?? NOW, expiresAt: over.expiresAt ?? at(14), status: over.status ?? 'PENDING', decidedAt: over.decidedAt },
  })
}

async function connect(x: { id: string }, y: { id: string }) {
  const req = await pending(x, y, { status: 'ACCEPTED', decidedAt: NOW })
  const [a, b] = x.id < y.id ? [x.id, y.id] : [y.id, x.id]
  return prisma.partnerConnection.create({ data: { userAId: a, userBId: b, requestId: req.id } })
}

beforeEach(async () => {
  await resetDb(prisma)
  // The seed has demo requests and a demo chat; these tests count rows globally, so start from empty matching tables.
  await prisma.partnerMessage.deleteMany()
  await prisma.connectionReadState.deleteMany()
  await prisma.sharedShortlistItem.deleteMany()
  await prisma.partnerConnection.deleteMany()
  await prisma.partnerRequest.deleteMany()
})

describe('send', () => {
  it('creates a PENDING request for 14 days and queues one email without message text or sender contact', async () => {
    const a = await mk()
    const b = await mk()
    const view = await send(a, b, 'Halo, kita sama-sama anak teknik.')
    expect(view).toMatchObject({ direction: 'sent', status: 'PENDING', message: 'Halo, kita sama-sama anak teknik.' })
    const row = await prisma.partnerRequest.findUniqueOrThrow({ where: { id: view.id } })
    expect(row.expiresAt.getTime()).toBe(at(14).getTime())
    const mails = await prisma.emailOutbox.findMany({ where: { template: 'matching-request' } })
    expect(mails).toHaveLength(1)
    const [ua, ub] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: a.id } }), prisma.user.findUniqueOrThrow({ where: { id: b.id } })])
    expect(mails[0]!.to).toBe(ub.email)
    const payload = JSON.stringify(mails[0]!.payload)
    expect(payload).not.toContain('sama-sama')
    expect(payload).not.toContain(ua.email)
    expect(payload).not.toContain(ua.name)
  })

  it('skips the email when the recipient opted out', async () => {
    const a = await mk()
    const b = await mk({ optOut: true })
    await send(a, b)
    expect(await prisma.emailOutbox.count({ where: { template: 'matching-request' } })).toBe(0)
  })

  it('refuses a profile younger than 24 hours, paused, inactive or missing', async () => {
    const b = await mk()
    const young = await mk({ ageDays: 0.5 })
    const e = await err(send(young, b))
    expect(e?.code).toBe('FORBIDDEN')
    expect(e?.message).toBe('Profil baru bisa mengirim permintaan 24 jam setelah dibuat.')
    // Exactly 24 h is enough.
    const edge = await mk({ ageDays: 1 })
    await expect(send(edge, b)).resolves.toBeTruthy()
    expect(await code(send(await mk({ paused: true }), b))).toBe('FORBIDDEN')
    expect(await code(send(await mk({ active: false }), b))).toBe('FORBIDDEN')
    const noProfile = await prisma.user.create({ data: { id: 'mt-none', name: 'x', email: 'none@kobo.test', emailVerified: true, campusEmailVerifiedAt: at(-1) } })
    expect(await code(send(noProfile, b))).toBe('FORBIDDEN')
  })

  it('answers NOT_FOUND for an ineligible, blocked or unknown target', async () => {
    const a = await mk()
    expect(await code(send(a, await mk({ gender: 'PEREMPUAN' })))).toBe('NOT_FOUND')
    expect(await code(send(a, await mk({ active: false })))).toBe('NOT_FOUND')
    expect(await code(send(a, await mk({ paused: true })))).toBe('NOT_FOUND')
    expect(await code(send(a, await mk({ verified: false })))).toBe('NOT_FOUND')
    expect(await code(send(a, { pid: 'nope' }))).toBe('NOT_FOUND')
    const blockedByMe = await mk()
    await prisma.userBlock.create({ data: { blockerId: a.id, blockedId: blockedByMe.id } })
    expect(await code(send(a, blockedByMe))).toBe('NOT_FOUND')
    const blocksMe = await mk()
    await prisma.userBlock.create({ data: { blockerId: blocksMe.id, blockedId: a.id } })
    expect(await code(send(a, blocksMe))).toBe('NOT_FOUND')
    const stale = await mk()
    await prisma.matchingProfile.update({ where: { id: stale.pid }, data: { lastActiveAt: at(-31) } })
    expect(await code(send(a, stale))).toBe('NOT_FOUND')
    expect(await prisma.partnerRequest.count()).toBe(0)
  })

  it('refuses a request to yourself', async () => {
    const a = await mk()
    expect(await code(send(a, a))).toBe('BAD_REQUEST')
  })

  it('refuses contact info in the message', async () => {
    const a = await mk()
    const b = await mk()
    expect(await code(send(a, b, 'WA saya 081234567890'))).toBe('BAD_REQUEST')
    expect(await code(send(a, b, 'cek kontak@mail.com'))).toBe('BAD_REQUEST')
    expect(await prisma.partnerRequest.count()).toBe(0)
  })

  it('refuses a duplicate PENDING either way and tells the caller to accept the incoming one', async () => {
    const a = await mk()
    const b = await mk()
    await send(a, b)
    expect(await code(send(a, b))).toBe('CONFLICT')
    const reverse = await err(send(b, a))
    expect(reverse?.code).toBe('CONFLICT')
    expect(reverse?.message).toContain('Terima')
  })

  it('races two identical sends into one request', async () => {
    const a = await mk()
    const b = await mk()
    const r = await Promise.allSettled([send(a, b), send(a, b)])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.partnerRequest.count({ where: { status: 'PENDING' } })).toBe(1)
  })

  it('refuses when a live connection exists, and allows it after the connection ended', async () => {
    const a = await mk()
    const b = await mk()
    const c = await connect(a, b)
    expect(await code(send(a, b))).toBe('CONFLICT')
    await prisma.partnerConnection.update({ where: { id: c.id }, data: { endedAt: NOW, endedById: a.id, endReason: 'ENDED_BY_USER' } })
    await expect(send(a, b)).resolves.toBeTruthy()
  })

  it('applies a 30 day cooldown after the target declined', async () => {
    const a = await mk()
    const b = await mk()
    const v = await send(a, b)
    await declineRequest(prisma, b.id, v.id, NOW)
    expect(await code(send(a, b, undefined, at(1)))).toBe('PRECONDITION_FAILED')
    expect(await code(send(a, b, undefined, at(29.9)))).toBe('PRECONDITION_FAILED')
    await prisma.matchingProfile.updateMany({ data: { lastActiveAt: at(31) } })
    await expect(send(a, b, undefined, at(30.1))).resolves.toBeTruthy()
  })

  it('caps outgoing PENDING requests at 10', async () => {
    const a = await mk()
    for (let i = 0; i < 10; i++) await pending(a, await mk(), { createdAt: at(-5 - i) })
    const e = await err(send(a, await mk()))
    expect(e?.code).toBe('TOO_MANY_REQUESTS')
    // A cancelled slot frees one.
    const first = await prisma.partnerRequest.findFirstOrThrow({ where: { fromUserId: a.id } })
    await cancelRequest(prisma, a.id, first.id, NOW)
    await expect(send(a, await mk())).resolves.toBeTruthy()
  })

  it('caps new requests at 10 per rolling 24 hours', async () => {
    const a = await mk()
    for (let i = 0; i < 10; i++) await pending(a, await mk(), { status: 'CANCELLED', createdAt: at(-1 / 24), decidedAt: NOW })
    const t = await mk()
    expect(await code(send(a, t))).toBe('TOO_MANY_REQUESTS')
    await prisma.matchingProfile.updateMany({ data: { lastActiveAt: at(1) } })
    await expect(send(a, t, undefined, at(1))).resolves.toBeTruthy()
  })

  it('refuses a sender who already has 3 live connections', async () => {
    const a = await mk()
    for (let i = 0; i < 3; i++) await connect(a, await mk())
    expect(await code(send(a, await mk()))).toBe('PRECONDITION_FAILED')
  })
})

describe('cancel and decline', () => {
  it('lets only the sender cancel and only the recipient decline', async () => {
    const a = await mk()
    const b = await mk()
    const v = await send(a, b)
    expect(await code(cancelRequest(prisma, b.id, v.id, NOW))).toBe('NOT_FOUND')
    expect(await code(declineRequest(prisma, a.id, v.id, NOW))).toBe('NOT_FOUND')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('PENDING')
    await cancelRequest(prisma, a.id, v.id, NOW)
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('CANCELLED')
    expect(await code(cancelRequest(prisma, a.id, v.id, NOW))).toBe('CONFLICT')
    const w = await send(a, b)
    await declineRequest(prisma, b.id, w.id, NOW)
    const d = await prisma.partnerRequest.findUniqueOrThrow({ where: { id: w.id } })
    expect(d.status).toBe('DECLINED')
    expect(d.decidedAt?.getTime()).toBe(NOW.getTime())
    expect(await code(declineRequest(prisma, b.id, w.id, NOW))).toBe('CONFLICT')
    // The sender sees the stored status; the frontend renders DECLINED as "Tidak dilanjutkan".
    const sentBox = await listRequests(prisma, a.id, { box: 'sent' }, NOW)
    expect(sentBox.items.find((i) => i.id === w.id)?.status).toBe('DECLINED')
  })

  it('treats an expired request as expired and persists it', async () => {
    const a = await mk()
    const b = await mk()
    const v = await send(a, b)
    const e = await err(declineRequest(prisma, b.id, v.id, at(14)))
    expect(e?.code).toBe('PRECONDITION_FAILED')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('EXPIRED')
    expect(await code(cancelRequest(prisma, a.id, v.id, at(15)))).toBe('PRECONDITION_FAILED')
  })

  it('answers NOT_FOUND for an outsider and for an unknown id', async () => {
    const a = await mk()
    const b = await mk()
    const o = await mk()
    const v = await send(a, b)
    expect(await code(cancelRequest(prisma, o.id, v.id, NOW))).toBe('NOT_FOUND')
    expect(await code(declineRequest(prisma, o.id, v.id, NOW))).toBe('NOT_FOUND')
    expect(await code(acceptRequest(prisma, o.id, v.id, NOW))).toBe('NOT_FOUND')
    expect(await code(acceptRequest(prisma, a.id, v.id, NOW))).toBe('NOT_FOUND')
    expect(await code(cancelRequest(prisma, a.id, 'nope', NOW))).toBe('NOT_FOUND')
  })
})

describe('accept', () => {
  it('creates one ordered connection and emails the sender', async () => {
    const a = await mk()
    const b = await mk()
    const v = await send(a, b)
    const conn = await acceptRequest(prisma, b.id, v.id, NOW)
    expect(conn.endedAt).toBeNull()
    expect(conn.partner.displayName).toMatch(/^Teman/)
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('ACCEPTED')
    const row = await prisma.partnerConnection.findUniqueOrThrow({ where: { requestId: v.id } })
    expect(row.userAId < row.userBId).toBe(true)
    expect([row.userAId, row.userBId].sort()).toEqual([a.id, b.id].sort())
    const mails = await prisma.emailOutbox.findMany({ where: { template: 'matching-accept' } })
    expect(mails.map((m) => m.to)).toEqual([(await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).email])
    // Sender opted out: no accept mail.
    const c = await mk({ optOut: true })
    const w = await send(c, b)
    await acceptRequest(prisma, b.id, w.id, NOW)
    expect(await prisma.emailOutbox.count({ where: { template: 'matching-accept' } })).toBe(1)
  })

  it('applies a double accept once', async () => {
    const a = await mk()
    const b = await mk()
    const v = await send(a, b)
    await acceptRequest(prisma, b.id, v.id, NOW)
    expect(await code(acceptRequest(prisma, b.id, v.id, NOW))).toBe('CONFLICT')
    expect(await prisma.partnerConnection.count()).toBe(1)
  })

  it('applies a racing double accept once', async () => {
    const a = await mk()
    const b = await mk()
    const v = await send(a, b)
    const r = await Promise.allSettled([acceptRequest(prisma, b.id, v.id, NOW), acceptRequest(prisma, b.id, v.id, NOW), acceptRequest(prisma, b.id, v.id, NOW)])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.partnerConnection.count()).toBe(1)
    expect(await prisma.emailOutbox.count({ where: { template: 'matching-accept' } })).toBe(1)
  })

  it('never lets a recipient exceed 3 live connections when accepting concurrently', async () => {
    const b = await mk()
    await connect(b, await mk())
    await connect(b, await mk())
    const s1 = await mk()
    const s2 = await mk()
    const v1 = await send(s1, b)
    const v2 = await send(s2, b)
    const r = await Promise.allSettled([acceptRequest(prisma, b.id, v1.id, NOW), acceptRequest(prisma, b.id, v2.id, NOW)])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.partnerConnection.count({ where: { OR: [{ userAId: b.id }, { userBId: b.id }], endedAt: null } })).toBe(3)
  })

  it('refuses at the cap with the exact message and leaves the request PENDING', async () => {
    const b = await mk()
    for (let i = 0; i < 3; i++) await connect(b, await mk())
    const s = await mk()
    const v = await pending(s, b)
    const e = await err(acceptRequest(prisma, b.id, v.id, NOW))
    expect(e?.code).toBe('PRECONDITION_FAILED')
    expect(e?.message).toBe('Akhiri satu koneksi dulu sebelum menerima permintaan baru.')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('PENDING')
    const box = await listRequests(prisma, b.id, { box: 'received' }, NOW)
    expect(box.items.find((i) => i.id === v.id)?.blockedByCap).toBe(true)
    // Ending one connection unblocks it.
    const live = await prisma.partnerConnection.findFirstOrThrow({ where: { OR: [{ userAId: b.id }, { userBId: b.id }] } })
    await endConnection(prisma, b.id, live.id, NOW)
    await expect(acceptRequest(prisma, b.id, v.id, NOW)).resolves.toBeTruthy()
  })

  it('re-checks eligibility and blocks, leaving the request PENDING', async () => {
    const a = await mk()
    const b = await mk()
    const v = await send(a, b)
    await prisma.userBlock.create({ data: { blockerId: a.id, blockedId: b.id } })
    expect(await code(acceptRequest(prisma, b.id, v.id, NOW))).toBe('NOT_FOUND')
    await prisma.userBlock.deleteMany()
    await prisma.matchingProfile.update({ where: { id: a.pid }, data: { active: false } })
    expect(await code(acceptRequest(prisma, b.id, v.id, NOW))).toBe('NOT_FOUND')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('PENDING')
    expect(await prisma.partnerConnection.count()).toBe(0)
  })

  it('refuses an expired request and persists EXPIRED', async () => {
    const a = await mk()
    const b = await mk()
    const v = await send(a, b)
    expect(await code(acceptRequest(prisma, b.id, v.id, at(14)))).toBe('PRECONDITION_FAILED')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('EXPIRED')
    expect(await prisma.partnerConnection.count()).toBe(0)
  })
})

describe('expiry', () => {
  it('expireRequests persists EXPIRED for due PENDING rows only', async () => {
    const a = await mk()
    const b = await mk()
    const c = await mk()
    const old = await pending(a, b, { expiresAt: at(-1) })
    const live = await pending(a, c, { expiresAt: at(5) })
    expect(await expireRequests(prisma, NOW)).toBe(1)
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: old.id } })).status).toBe('EXPIRED')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: live.id } })).status).toBe('PENDING')
  })

  it('list expires lazily and a new request can follow', async () => {
    const a = await mk()
    const b = await mk()
    const v = await send(a, b)
    const box = await listRequests(prisma, a.id, { box: 'sent' }, at(15))
    expect(box.items.find((i) => i.id === v.id)?.status).toBe('EXPIRED')
    await prisma.matchingProfile.updateMany({ data: { lastActiveAt: at(15) } })
    await expect(send(a, b, undefined, at(15))).resolves.toBeTruthy()
  })
})

describe('list', () => {
  it('returns only the callers own rows, newest first, with display info and no PII', async () => {
    const a = await mk({ name: 'Ayu' })
    const b = await mk({ name: 'Bima' })
    const c = await mk({ name: 'Citra' })
    const o = await mk()
    await pending(a, b, { createdAt: at(-3) })
    await pending(a, c, { createdAt: at(-0.5) })
    const d = await mk({ name: 'Dani' })
    await pending(d, a, { createdAt: at(-2) })
    await pending(o, b)
    const sent = await listRequests(prisma, a.id, { box: 'sent' }, NOW)
    expect(sent.items.map((i) => i.partner.displayName)).toEqual(['Citra', 'Bima'])
    expect(sent.items[0]).toMatchObject({ direction: 'sent', partner: { profileId: c.pid, ageBand: '27+', deleted: false } })
    const got = await listRequests(prisma, a.id, { box: 'received' }, NOW)
    expect(got.items.map((i) => i.partner.displayName)).toEqual(['Dani'])
    expect(sent.pendingSlotsLeft).toBe(8)
    expect(sent.sentTodayLeft).toBe(9)
    const json = JSON.stringify([sent, got])
    for (const id of [a.id, b.id, c.id, d.id, o.id]) expect(json).not.toContain(id)
    expect(json).not.toMatch(/birthYear|userId|email|@kobo\.test|phone/i)
  })

  it('pages at 20', async () => {
    const a = await mk()
    const t = await mk()
    for (let i = 0; i < 25; i++) await pending(a, t, { status: 'CANCELLED', createdAt: at(-i - 1), decidedAt: NOW })
    const page = await listRequests(prisma, a.id, { box: 'sent' }, NOW)
    expect(page.items).toHaveLength(20)
  })

  it('shows "Pengguna KoBo" when the partner profile was deleted', async () => {
    const a = await mk()
    const b = await mk()
    await send(a, b)
    await prisma.matchingProfile.delete({ where: { id: b.pid } })
    const box = await listRequests(prisma, a.id, { box: 'sent' }, NOW)
    expect(box.items[0]!.partner).toEqual({ profileId: null, displayName: 'Pengguna KoBo', deleted: true, ageBand: null })
    expect(box.items[0]!.match).toBeNull()
  })
})

describe('connections', () => {
  it('lists live first with partner display info and leaks no PII', async () => {
    const a = await mk()
    const b = await mk({ name: 'Bima' })
    const c = await mk({ name: 'Citra' })
    const ended = await connect(a, b)
    await prisma.partnerConnection.update({ where: { id: ended.id }, data: { endedAt: NOW, endedById: a.id, endReason: 'ENDED_BY_USER' } })
    await connect(a, c)
    const list = await listConnections(prisma, a.id, NOW)
    expect(list.map((x) => [x.partner.displayName, x.endedAt === null])).toEqual([['Citra', true], ['Bima', false]])
    expect(list[1]!.endReason).toBe('ENDED_BY_USER')
    expect(list[0]!.partner.profileId).toBe(c.pid)
    const json = JSON.stringify(list)
    for (const id of [a.id, b.id, c.id]) expect(json).not.toContain(id)
    expect(json).not.toMatch(/birthYear|userId|email|@kobo\.test/i)
  })

  it('shows "Pengguna KoBo" for a deleted partner profile', async () => {
    const a = await mk()
    const b = await mk()
    await connect(a, b)
    await prisma.matchingProfile.delete({ where: { id: b.pid } })
    const [c] = await listConnections(prisma, a.id, NOW)
    expect(c!.partner.displayName).toBe('Pengguna KoBo')
    expect(c!.partner.deleted).toBe(true)
  })

  it('ends a connection for a participant only, recording who and why', async () => {
    const a = await mk()
    const b = await mk()
    const o = await mk()
    const c = await connect(a, b)
    expect(await code(endConnection(prisma, o.id, c.id, NOW))).toBe('NOT_FOUND')
    expect(await code(endConnection(prisma, a.id, 'nope', NOW))).toBe('NOT_FOUND')
    await endConnection(prisma, b.id, c.id, NOW)
    const row = await prisma.partnerConnection.findUniqueOrThrow({ where: { id: c.id } })
    expect(row).toMatchObject({ endedById: b.id, endReason: 'ENDED_BY_USER' })
    expect(row.endedAt?.getTime()).toBe(NOW.getTime())
    expect(await code(endConnection(prisma, a.id, c.id, at(1)))).toBe('CONFLICT')
  })
})

describe('tRPC wiring', () => {
  it('runs the full flow through the router and refuses non-participants with NOT_FOUND', async () => {
    const a = await mk()
    const b = await mk()
    const o = await mk()
    const v = await callerFor(a.id).matching.request.send({ profileId: b.pid, message: 'Halo' })
    expect(v.status).toBe('PENDING')
    const outsider = callerFor(o.id).matching
    expect((await err(outsider.request.cancel({ requestId: v.id })))?.code).toBe('NOT_FOUND')
    expect((await err(outsider.request.decline({ requestId: v.id })))?.code).toBe('NOT_FOUND')
    expect((await err(outsider.request.accept({ requestId: v.id })))?.code).toBe('NOT_FOUND')
    expect((await callerFor(o.id).matching.request.list({ box: 'received' })).items).toHaveLength(0)
    const conn = await callerFor(b.id).matching.request.accept({ requestId: v.id })
    expect((await err(outsider.connection.end({ connectionId: conn.id })))?.code).toBe('NOT_FOUND')
    expect(await callerFor(a.id).matching.connection.list()).toHaveLength(1)
    await callerFor(a.id).matching.connection.end({ connectionId: conn.id })
    expect((await callerFor(b.id).matching.connection.list())[0]!.endedAt).not.toBeNull()
  })

  it('refuses an unverified student at the guard', async () => {
    const u = await mk({ verified: false })
    const b = await mk()
    expect((await err(callerFor(u.id).matching.request.send({ profileId: b.pid })))?.code).toBe('FORBIDDEN')
  })
})
