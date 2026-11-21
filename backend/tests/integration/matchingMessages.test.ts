import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, newStudent, prisma } from '../helpers.ts'
import { err, startIn, verifyAtCampus } from './gap-helpers.ts'

const DAY = 86_400_000

beforeEach(async () => {
  await resetDb(prisma)
  // The seed has a demo chat and requests; these tests count rows globally, so start from empty matching tables.
  await prisma.partnerMessage.deleteMany()
  await prisma.connectionReadState.deleteMany()
  await prisma.sharedShortlistItem.deleteMany()
  await prisma.userReport.deleteMany()
  await prisma.userBlock.deleteMany()
  await prisma.partnerConnection.deleteMany()
  await prisma.partnerRequest.deleteMany()
  await prisma.matchingProfile.deleteMany()
})

let seq = 0
async function person(over: Record<string, unknown> = {}) {
  const u = await newStudent()
  await verifyAtCampus(u.id)
  const c = callerFor(u.id).matching
  const p = await c.profile.upsert({
    displayName: `Teman ${++seq}`,
    gender: 'PEREMPUAN',
    birthYear: 2004,
    budgetMin: 1_000_000,
    budgetMax: 2_000_000,
    anchorLat: -6.2017,
    anchorLng: 106.7819,
    anchorLabel: 'BINUS Anggrek',
    moveInDate: startIn(30),
    smoking: 'TIDAK_MEROKOK_TOLERAN',
    ...over,
  })
  return { id: u.id, profileId: p.id, c }
}

async function connect(a: string, b: string, ended = false) {
  const req = await prisma.partnerRequest.create({ data: { fromUserId: a, toUserId: b, status: 'ACCEPTED', expiresAt: new Date(Date.now() + 14 * DAY) } })
  const [lo, hi] = [a, b].sort() as [string, string]
  return prisma.partnerConnection.create({ data: { userAId: lo, userBId: hi, requestId: req.id, ...(ended ? { endedAt: new Date(), endReason: 'ENDED_BY_USER' as const } : {}) } })
}

async function pair() {
  const a = await person()
  const b = await person()
  const conn = await connect(a.id, b.id)
  return { a, b, conn }
}

describe('messages: access', () => {
  it('a non-participant gets NOT_FOUND on every message procedure', async () => {
    const { conn } = await pair()
    const x = await person()
    expect((await err(x.c.message.list({ connectionId: conn.id })))?.code).toBe('NOT_FOUND')
    expect((await err(x.c.message.send({ connectionId: conn.id, body: 'halo' })))?.code).toBe('NOT_FOUND')
    expect((await err(x.c.message.markRead({ connectionId: conn.id })))?.code).toBe('NOT_FOUND')
    expect(await prisma.partnerMessage.count()).toBe(0)
  })

  it('sends and lists, with mine flags and no ids of users', async () => {
    const { a, b, conn } = await pair()
    const sent = await a.c.message.send({ connectionId: conn.id, body: '  Halo, kamu jadi ambil kos?  ' })
    expect(sent).toMatchObject({ sent: true, message: { mine: true, body: 'Halo, kamu jadi ambil kos?' } })
    const page = await b.c.message.list({ connectionId: conn.id })
    expect(page.canSend).toBe(true)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.mine).toBe(false)
    const json = JSON.stringify([sent, page])
    expect(json).not.toContain(a.id)
    expect(json).not.toContain(b.id)
    expect(json).not.toContain('@kobo.test')
  })

  it('rejects an over-long body', async () => {
    const { a, conn } = await pair()
    expect((await err(a.c.message.send({ connectionId: conn.id, body: 'x'.repeat(1001) })))?.code).toBe('BAD_REQUEST')
    expect((await a.c.message.send({ connectionId: conn.id, body: 'x'.repeat(1000) })).sent).toBe(true)
  })
})

describe('messages: ended and blocked', () => {
  it('an ended connection is readable but not writable', async () => {
    const { a, b } = { a: await person(), b: await person() }
    const conn = await connect(a.id, b.id)
    await a.c.message.send({ connectionId: conn.id, body: 'sebelum selesai' })
    await prisma.partnerConnection.update({ where: { id: conn.id }, data: { endedAt: new Date(), endReason: 'ENDED_BY_USER' } })
    const page = await b.c.message.list({ connectionId: conn.id })
    expect(page.items).toHaveLength(1)
    expect(page.canSend).toBe(false)
    expect((await err(b.c.message.send({ connectionId: conn.id, body: 'masih bisa?' })))?.code).toBe('FORBIDDEN')
    await b.c.message.markRead({ connectionId: conn.id })
    expect(await prisma.partnerMessage.count()).toBe(1)
  })

  it('a blocked user is hidden from discovery and cannot message', async () => {
    const { a, b, conn } = await pair()
    const c3 = await person()
    // a and c3 are discoverable to each other; b (connected) is not. Block c3 and it disappears.
    expect((await a.c.discover()).items.map((i) => i.profileId)).toContain(c3.profileId)
    await a.c.safety.block({ profileId: c3.profileId })
    expect((await a.c.discover()).items.map((i) => i.profileId)).not.toContain(c3.profileId)
    expect((await c3.c.discover()).items.map((i) => i.profileId)).not.toContain(a.profileId)

    await a.c.safety.block({ profileId: b.profileId })
    expect((await err(b.c.message.send({ connectionId: conn.id, body: 'halo' })))?.code).toBe('FORBIDDEN')
    expect((await a.c.message.list({ connectionId: conn.id })).canSend).toBe(false)
  })

  it('a block with a still-live connection row (legacy data) also refuses sending', async () => {
    const { a, b, conn } = await pair()
    await prisma.userBlock.create({ data: { blockerId: a.id, blockedId: b.id } })
    expect((await err(a.c.message.send({ connectionId: conn.id, body: 'halo' })))?.code).toBe('FORBIDDEN')
  })
})

describe('messages: contact confirm', () => {
  it('stores nothing until confirmed, then marks hadContact', async () => {
    const { a, conn } = await pair()
    const first = await a.c.message.send({ connectionId: conn.id, body: 'chat ke 081234567890 ya' })
    expect(first).toEqual({ sent: false, needsConfirm: true })
    expect(await prisma.partnerMessage.count()).toBe(0)
    const again = await a.c.message.send({ connectionId: conn.id, body: 'chat ke 081234567890 ya', confirmContact: false })
    expect(again).toEqual({ sent: false, needsConfirm: true })
    const ok = await a.c.message.send({ connectionId: conn.id, body: 'chat ke 081234567890 ya', confirmContact: true })
    expect(ok.sent).toBe(true)
    expect(await prisma.partnerMessage.findMany({ select: { hadContact: true } })).toEqual([{ hadContact: true }])
    await a.c.message.send({ connectionId: conn.id, body: 'biasa saja' })
    expect(await prisma.partnerMessage.count({ where: { hadContact: false } })).toBe(1)
  })
})

describe('messages: paging and unread', () => {
  it('pages newest first, 30 at a time, without gaps or repeats (equal timestamps too)', async () => {
    const { a, conn } = await pair()
    const t = new Date('2026-12-01T10:00:00.000Z')
    await prisma.partnerMessage.createMany({
      data: Array.from({ length: 65 }, (_, i) => ({ connectionId: conn.id, senderId: a.id, body: `m${i}`, createdAt: new Date(t.getTime() + Math.floor(i / 2) * 1000) })),
    })
    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const p = await a.c.message.list({ connectionId: conn.id, cursor })
      expect(p.items.length).toBeLessThanOrEqual(30)
      seen.push(...p.items.map((m) => m.body))
      cursor = p.nextCursor ?? undefined
      pages++
    } while (cursor)
    expect(pages).toBe(3)
    expect(new Set(seen).size).toBe(65)
    // First page holds the newest 30, oldest first within the page.
    const first = await a.c.message.list({ connectionId: conn.id })
    expect(first.items.map((m) => m.body)).toContain('m64')
    expect(first.items.map((m) => m.body)).not.toContain('m0')
    expect((await err(a.c.message.list({ connectionId: conn.id, cursor: 'rusak' })))?.code).toBe('BAD_REQUEST')
  })

  it('counts unread per connection and clears on markRead', async () => {
    const a = await person()
    const b = await person()
    const c = await person()
    const ab = await connect(a.id, b.id)
    const ac = await connect(a.id, c.id)
    await b.c.message.send({ connectionId: ab.id, body: 'satu' })
    await b.c.message.send({ connectionId: ab.id, body: 'dua' })
    await c.c.message.send({ connectionId: ac.id, body: 'tiga' })
    await a.c.message.send({ connectionId: ab.id, body: 'balasan saya' })
    await prisma.partnerRequest.create({ data: { fromUserId: (await person()).id, toUserId: a.id, expiresAt: new Date(Date.now() + DAY) } })

    const u = await a.c.message.unreadCount()
    expect(u).toMatchObject({ messages: 3, requests: 1, perConnection: { [ab.id]: 2, [ac.id]: 1 } })

    await a.c.message.markRead({ connectionId: ab.id })
    const u2 = await a.c.message.unreadCount()
    expect(u2.messages).toBe(1)
    expect(u2.perConnection).toEqual({ [ac.id]: 1 })
    expect(await prisma.connectionReadState.count({ where: { userId: a.id } })).toBe(1)
    await a.c.message.markRead({ connectionId: ab.id })
    expect(await prisma.connectionReadState.count({ where: { userId: a.id } })).toBe(1)
  })
})
