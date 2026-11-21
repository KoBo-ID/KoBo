import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, newStudent, prisma } from '../helpers.ts'
import { err, startIn, verifyAtCampus } from './gap-helpers.ts'

const DAY = 86_400_000
const LAT = -6.2017
const LNG = 106.7819

beforeEach(async () => {
  await resetDb(prisma)
  await prisma.matchingProfile.deleteMany()
})

const core = (over: Record<string, unknown> = {}) => ({
  displayName: 'Rani',
  gender: 'PEREMPUAN' as const,
  birthYear: 2004,
  budgetMin: 1_000_000,
  budgetMax: 2_000_000,
  anchorLat: LAT,
  anchorLng: LNG,
  anchorLabel: 'BINUS Anggrek',
  moveInDate: startIn(30),
  smoking: 'TIDAK_MEROKOK_TOLERAN' as const,
  ...over,
})

/** A verified student with a profile (via the real upsert) and an old enough, recently active row. */
let seq = 0
async function person(over: Record<string, unknown> = {}, opts: { isDemo?: boolean; verified?: boolean } = {}) {
  const u = await newStudent()
  if (opts.verified !== false) await verifyAtCampus(u.id)
  if (opts.isDemo) await prisma.user.update({ where: { id: u.id }, data: { isDemo: true } })
  const c = callerFor(u.id, { isDemo: opts.isDemo }).matching
  const p = await c.profile.upsert(core({ displayName: `Teman ${++seq}`, ...over }))
  return { id: u.id, profileId: p.id, c }
}

const pending = (from: string, to: string) =>
  prisma.partnerRequest.create({ data: { fromUserId: from, toUserId: to, status: 'PENDING', expiresAt: new Date(Date.now() + 14 * DAY) } })

async function connect(a: string, b: string) {
  const req = await prisma.partnerRequest.create({ data: { fromUserId: a, toUserId: b, status: 'ACCEPTED', expiresAt: new Date(Date.now() + 14 * DAY) } })
  const [lo, hi] = [a, b].sort() as [string, string]
  return prisma.partnerConnection.create({ data: { userAId: lo, userBId: hi, requestId: req.id } })
}

describe('discover eligibility', () => {
  it('never returns self, blocked, other gender, idle, past move-in, hidden, paused, unverified, or an existing request or connection', async () => {
    const me = await person()
    const ok = await person()
    const blockedByMe = await person()
    const blockedMe = await person()
    const male = await person({ gender: 'LAKI_LAKI' })
    const idle = await person()
    const past = await person()
    const hidden = await person()
    const paused = await person()
    const inactive = await person()
    const hasPending = await person()
    const incoming = await person()
    const connected = await person()
    const lostVerification = await person()
    const demo = await person({}, { isDemo: true })

    await prisma.userBlock.create({ data: { blockerId: me.id, blockedId: blockedByMe.id } })
    await prisma.userBlock.create({ data: { blockerId: blockedMe.id, blockedId: me.id } })
    await prisma.matchingProfile.update({ where: { id: idle.profileId }, data: { lastActiveAt: new Date(Date.now() - 31 * DAY) } })
    await prisma.matchingProfile.update({ where: { id: past.profileId }, data: { moveInDate: new Date(Date.now() - 3 * DAY) } })
    await prisma.matchingProfile.update({ where: { id: hidden.profileId }, data: { hiddenByReportsAt: new Date() } })
    await prisma.matchingProfile.update({ where: { id: paused.profileId }, data: { pausedAt: new Date() } })
    await prisma.matchingProfile.update({ where: { id: inactive.profileId }, data: { active: false } })
    await prisma.user.update({ where: { id: lostVerification.id }, data: { campusVerifiedUntil: new Date(Date.now() - 1000) } })
    await pending(me.id, hasPending.id)
    await pending(incoming.id, me.id)
    await connect(me.id, connected.id)

    const res = await me.c.discover()
    expect(res.emptyReason).toBeNull()
    expect(res.items.map((i) => i.profileId)).toEqual([ok.profileId])
    for (const bad of [male, demo]) expect(res.items.some((i) => i.profileId === bad.profileId)).toBe(false)
  })

  it('shows an idle profile again after 29 days, and a move-in of today', async () => {
    const me = await person()
    const a = await person()
    const b = await person({ moveInDate: startIn(0) })
    await prisma.matchingProfile.update({ where: { id: a.profileId }, data: { lastActiveAt: new Date(Date.now() - 29 * DAY) } })
    const ids = (await me.c.discover()).items.map((i) => i.profileId)
    expect(ids.sort()).toEqual([a.profileId, b.profileId].sort())
  })

  it('applies the hard filters (budget, mutual radius, smoking conflict)', async () => {
    const me = await person({ smoking: 'MEROKOK' })
    await person({ budgetMin: 2_500_000, budgetMax: 3_500_000 })
    await person({ anchorLat: LAT + 0.1 })
    await person({ smoking: 'TIDAK_MAU_PEROKOK' })
    const near = await person({ smoking: 'MEROKOK' })
    expect((await me.c.discover()).items.map((i) => i.profileId)).toEqual([near.profileId])
  })

  it('demo profiles are visible only to demo users', async () => {
    const real = await person()
    const demoA = await person({}, { isDemo: true })
    const demoB = await person({}, { isDemo: true })
    expect((await real.c.discover()).emptyReason).toBe('COLD_START')
    expect((await demoA.c.discover()).items.map((i) => i.profileId).sort()).toEqual([demoB.profileId, real.profileId].sort())
  })

  it('sorts by score then distance, and filters', async () => {
    const me = await person()
    const far = await person({ anchorLat: LAT + 0.02, budgetMin: 1_900_000, budgetMax: 2_000_000, moveInDate: startIn(80) })
    const close = await person()
    const mid = await person({ anchorLat: LAT + 0.01 })
    const bySkor = await me.c.discover({ sort: 'skor' })
    expect(bySkor.items[0]!.profileId).toBe(close.profileId)
    expect(bySkor.items.map((i) => i.match.score)).toEqual([...bySkor.items.map((i) => i.match.score)].sort((a, b) => b - a))
    const byJarak = await me.c.discover({ sort: 'jarak' })
    expect(byJarak.items.map((i) => i.profileId)).toEqual([close.profileId, mid.profileId, far.profileId])
    expect((await me.c.discover({ maxDistanceKm: 1.5 })).items.map((i) => i.profileId).sort()).toEqual([close.profileId, mid.profileId].sort())
    expect((await me.c.discover({ moveInBefore: startIn(40) })).items.map((i) => i.profileId).sort()).toEqual([close.profileId, mid.profileId].sort())
    expect((await me.c.discover({ budgetMin: 1_950_000 })).items).toHaveLength(3)
  })

  it('rounds distances to 0.5 km', async () => {
    const me = await person()
    await person({ anchorLat: LAT + 0.0137 })
    const [item] = (await me.c.discover()).items
    expect((item!.distanceKm * 2) % 1).toBe(0)
  })
})

describe('discover empty reasons', () => {
  it('NO_PROFILE when the caller has no profile', async () => {
    const u = await newStudent()
    await verifyAtCampus(u.id)
    expect(await callerFor(u.id).matching.discover()).toEqual({ items: [], nextCursor: null, emptyReason: 'NO_PROFILE' })
  })

  it('INACTIVE when the caller profile is inactive or paused', async () => {
    const me = await person()
    await person()
    await me.c.profile.setActive({ active: false })
    expect((await me.c.discover()).emptyReason).toBe('INACTIVE')
    await me.c.profile.setActive({ active: true })
    await me.c.profile.markFound()
    expect((await me.c.discover()).emptyReason).toBe('INACTIVE')
  })

  it('COLD_START when nobody is eligible before filters', async () => {
    const me = await person()
    await person({ gender: 'LAKI_LAKI' })
    expect(await me.c.discover()).toMatchObject({ items: [], emptyReason: 'COLD_START' })
  })

  it('TOO_NARROW with a widen hint of +2 km and the extra count', async () => {
    const me = await person()
    // About 4.2 km away: outside the caller radius (3), inside once widened to 5.
    await person({ anchorLat: LAT + 0.038, radiusKm: 6 })
    await person({ anchorLat: LAT + 0.038, radiusKm: 6 })
    // About 20 km away: never.
    await person({ anchorLat: LAT + 0.18, radiusKm: 15 })
    const res = await me.c.discover()
    expect(res).toMatchObject({ items: [], nextCursor: null, emptyReason: 'TOO_NARROW', widenHint: { radiusKm: 5, extra: 2 } })
    expect(JSON.stringify(res)).not.toMatch(/profileId/)
  })

  it('TOO_NARROW when only the user filters exclude everyone', async () => {
    const me = await person()
    await person()
    const res = await me.c.discover({ budgetMin: 3_500_000 })
    expect(res.emptyReason).toBe('TOO_NARROW')
    expect(res.widenHint?.extra).toBe(0)
  })
})

describe('discover pagination', () => {
  it('pages by 20 and caps the computed list at 100', async () => {
    const me = await person()
    const ids: string[] = []
    for (let i = 0; i < 110; i++) ids.push(`pg-${String(i).padStart(3, '0')}`)
    await prisma.user.createMany({ data: ids.map((id) => ({ id, name: id, email: `${id}@kobo.test`, emailVerified: true, campusEmailVerifiedAt: new Date(), campusVerifiedVia: 'EMAIL' as const, campusVerifiedUntil: new Date(Date.now() + 30 * DAY) })) })
    await prisma.matchingProfile.createMany({
      data: ids.map((id) => ({
        userId: id, displayName: id, gender: 'PEREMPUAN' as const, birthYear: 2004, budgetMin: 1_000_000, budgetMax: 2_000_000,
        anchorLat: LAT, anchorLng: LNG, anchorLabel: 'BINUS', moveInDate: new Date(`${startIn(30)}T00:00:00.000Z`), smoking: 'TIDAK_MEROKOK_TOLERAN' as const, active: true,
      })),
    })
    const seen = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await me.c.discover({ cursor })
      expect(page.items.length).toBeLessThanOrEqual(20)
      for (const i of page.items) seen.add(i.profileId)
      cursor = page.nextCursor ?? undefined
      pages += 1
    } while (cursor)
    expect(pages).toBe(5)
    expect(seen.size).toBe(100)
  })
})

describe('detail', () => {
  it('returns the candidate with the score breakdown for an eligible pair', async () => {
    const me = await person()
    const o = await person()
    const d = await me.c.detail({ profileId: o.profileId })
    expect(d).toMatchObject({ profileId: o.profileId, relation: 'NONE', ageBand: '21-23' })
    expect(d.match.parts).toHaveLength(6)
    expect(d.match.parts.reduce((s, p) => s + p.points, 0)).toBe(d.match.score)
  })

  it('is NOT_FOUND for self, unknown ids, other gender, idle, blocked either way', async () => {
    const me = await person()
    const male = await person({ gender: 'LAKI_LAKI' })
    const idle = await person()
    const blockedByMe = await person()
    const blockedMe = await person()
    await prisma.matchingProfile.update({ where: { id: idle.profileId }, data: { lastActiveAt: new Date(Date.now() - 40 * DAY) } })
    await prisma.userBlock.create({ data: { blockerId: me.id, blockedId: blockedByMe.id } })
    await prisma.userBlock.create({ data: { blockerId: blockedMe.id, blockedId: me.id } })
    for (const id of [me.profileId, 'nope', male.profileId, idle.profileId, blockedByMe.profileId, blockedMe.profileId]) {
      expect((await err(me.c.detail({ profileId: id })))?.code, id).toBe('NOT_FOUND')
    }
  })

  it('shows a paired profile even when it is no longer eligible, with the relation, but not when blocked', async () => {
    const me = await person()
    const sent = await person()
    const got = await person()
    const conn = await person()
    const blocked = await person()
    const reqSent = await pending(me.id, sent.id)
    const reqGot = await pending(got.id, me.id)
    const c = await connect(me.id, conn.id)
    await connect(me.id, blocked.id)
    await prisma.userBlock.create({ data: { blockerId: blocked.id, blockedId: me.id } })
    for (const p of [sent, got, conn, blocked]) await prisma.matchingProfile.update({ where: { id: p.profileId }, data: { pausedAt: new Date() } })

    expect(await me.c.detail({ profileId: sent.profileId })).toMatchObject({ relation: 'REQUEST_SENT', requestId: reqSent.id })
    expect(await me.c.detail({ profileId: got.profileId })).toMatchObject({ relation: 'REQUEST_RECEIVED', requestId: reqGot.id })
    expect(await me.c.detail({ profileId: conn.profileId })).toMatchObject({ relation: 'CONNECTED', connectionId: c.id })
    expect((await err(me.c.detail({ profileId: blocked.profileId })))?.code).toBe('NOT_FOUND')
  })

  it('a declined pair stays viewable', async () => {
    const me = await person()
    const o = await person()
    await prisma.matchingProfile.update({ where: { id: o.profileId }, data: { pausedAt: new Date() } })
    expect((await err(me.c.detail({ profileId: o.profileId })))?.code).toBe('NOT_FOUND')
    await prisma.partnerRequest.create({ data: { fromUserId: me.id, toUserId: o.id, status: 'DECLINED', expiresAt: new Date(Date.now() + DAY), decidedAt: new Date() } })
    expect(await me.c.detail({ profileId: o.profileId })).toMatchObject({ relation: 'NONE' })
  })
})

describe('privacy of responses', () => {
  it('discover and detail JSON carry no email, phone pattern, userId or birth year', async () => {
    const me = await person()
    const others = [await person(), await person({ intro: 'Suka belajar di perpustakaan' })]
    await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { phone: '+6281234567890' } })
    const discovered = await me.c.discover()
    expect(discovered.items).toHaveLength(2)
    const detailed = await me.c.detail({ profileId: others[0]!.profileId })
    const json = JSON.stringify([discovered, detailed])
    expect(json).not.toContain('@')
    expect(json).not.toMatch(/(\+62|\b0)8\d{7,}/)
    expect(json).not.toMatch(/\d{10,}/)
    for (const id of [me.id, ...others.map((o) => o.id)]) expect(json).not.toContain(id)
    expect(json).not.toMatch(/birthYear|userId|"phone"|"email"|anchorLat|anchorLng/)
  })
})
