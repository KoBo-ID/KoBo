import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, newStudent, prisma } from '../helpers.ts'
import { err, newOwner, startIn, verifyAtCampus } from './gap-helpers.ts'

beforeEach(async () => {
  await resetDb(prisma)
  await prisma.matchingProfile.deleteMany()
})

const CORE = {
  displayName: 'Rani',
  gender: 'PEREMPUAN' as const,
  birthYear: 2004,
  budgetMin: 1_000_000,
  budgetMax: 2_000_000,
  anchorLat: -6.2017,
  anchorLng: 106.7819,
  anchorLabel: 'BINUS Anggrek',
  moveInDate: startIn(30),
  smoking: 'TIDAK_MEROKOK_TOLERAN' as const,
}

// canSendRequests is on the runtime view (S1) but not yet on the shared MyMatchingProfile type.
const can = (p: unknown) => (p as { canSendRequests: boolean }).canSendRequests

async function student(over: { isDemo?: boolean } = {}) {
  const u = await newStudent()
  await verifyAtCampus(u.id)
  if (over.isDemo) await prisma.user.update({ where: { id: u.id }, data: { isDemo: true } })
  return { id: u.id, c: callerFor(u.id, { isDemo: over.isDemo }).matching }
}

describe('matching guard', () => {
  it('refuses an unverified student with FORBIDDEN', async () => {
    const u = await newStudent()
    const c = callerFor(u.id).matching
    expect((await err(c.profile.get()))?.code).toBe('FORBIDDEN')
    expect((await err(c.profile.upsert(CORE)))?.code).toBe('FORBIDDEN')
    expect((await err(c.discover()))?.code).toBe('FORBIDDEN')
    expect(await prisma.matchingProfile.count()).toBe(0)
  })

  it('refuses an owner who is not a verified student', async () => {
    const o = await newOwner()
    expect((await err(o.c.matching.profile.get()))?.code).toBe('FORBIDDEN')
    expect((await err(o.c.matching.detail({ profileId: 'x' })))?.code).toBe('FORBIDDEN')
  })

  it('refuses a student whose verification has expired', async () => {
    const u = await newStudent()
    await verifyAtCampus(u.id, 'binus-syahdan', new Date(Date.now() - 1000))
    expect((await err(callerFor(u.id).matching.profile.get()))?.code).toBe('FORBIDDEN')
  })

  it('lets a demo account in without verification', async () => {
    const u = await newStudent()
    await prisma.user.update({ where: { id: u.id }, data: { isDemo: true } })
    expect(await callerFor(u.id, { isDemo: true }).matching.profile.get()).toBeNull()
  })
})

describe('profile CRUD (own row only)', () => {
  it('get is null before a profile exists', async () => {
    const a = await student()
    expect(await a.c.profile.get()).toBeNull()
  })

  it('upsert creates an active profile from the core fields with defaults and copies the verified campus', async () => {
    const a = await student()
    const p = await a.c.profile.upsert(CORE)
    expect(p).toMatchObject({ active: true, campusId: 'binus-syahdan', radiusKm: 3, durationMonths: 12, roomShare: 2, kosType: 'PUTRI', sleep: 'BEBAS', intro: '', pausedAt: null })
    expect(can(p)).toBe(false)
    expect(await a.c.profile.get()).toMatchObject({ id: p.id, displayName: 'Rani' })
  })

  it('upsert again updates the same row and keeps an explicit kosType', async () => {
    const a = await student()
    const first = await a.c.profile.upsert({ ...CORE, kosType: 'CAMPUR' })
    const second = await a.c.profile.upsert({ ...CORE, displayName: 'Rani B', radiusKm: 5 })
    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({ displayName: 'Rani B', radiusKm: 5, kosType: 'CAMPUR' })
    expect(await prisma.matchingProfile.count()).toBe(1)
  })

  it('refuses contact info in the intro and under-18 birth years', async () => {
    const a = await student()
    expect((await err(a.c.profile.upsert({ ...CORE, intro: 'WA saya 081234567890' })))?.code).toBe('BAD_REQUEST')
    expect((await err(a.c.profile.upsert({ ...CORE, intro: 'email rani@kampus.ac.id' })))?.code).toBe('BAD_REQUEST')
    const e = await err(a.c.profile.upsert({ ...CORE, birthYear: new Date().getUTCFullYear() - 17 }))
    expect(e?.code).toBe('BAD_REQUEST')
    expect(await prisma.matchingProfile.count()).toBe(0)
  })

  it('acts on the caller row only', async () => {
    const a = await student()
    const b = await student()
    const pa = await a.c.profile.upsert(CORE)
    const pb = await b.c.profile.upsert({ ...CORE, displayName: 'Budi', gender: 'LAKI_LAKI' })
    await a.c.profile.setActive({ active: false })
    await a.c.profile.setEmailOptOut({ emailOptOut: true })
    await a.c.profile.markFound()
    await a.c.profile.delete()
    expect(await prisma.matchingProfile.findUnique({ where: { id: pa.id } })).toBeNull()
    const kept = await prisma.matchingProfile.findUniqueOrThrow({ where: { id: pb.id } })
    expect(kept).toMatchObject({ active: true, emailOptOut: false, pausedAt: null, displayName: 'Budi' })
  })

  it('setActive toggles, resuming clears the pause; setEmailOptOut stores the flag', async () => {
    const a = await student()
    await a.c.profile.upsert(CORE)
    expect((await a.c.profile.markFound()).pausedAt).not.toBeNull()
    expect(await a.c.profile.setActive({ active: false })).toMatchObject({ active: false })
    expect(await a.c.profile.setActive({ active: true })).toMatchObject({ active: true, pausedAt: null })
    expect((await a.c.profile.setEmailOptOut({ emailOptOut: true })).emailOptOut).toBe(true)
  })

  it('mutations without a profile are NOT_FOUND', async () => {
    const a = await student()
    expect((await err(a.c.profile.setActive({ active: true })))?.code).toBe('NOT_FOUND')
    expect((await err(a.c.profile.markFound()))?.code).toBe('NOT_FOUND')
    expect((await err(a.c.profile.setEmailOptOut({ emailOptOut: true })))?.code).toBe('NOT_FOUND')
  })

  it('S1: a profile younger than 24 hours cannot send requests, an older one can', async () => {
    const a = await student()
    const p = await a.c.profile.upsert(CORE)
    expect(can(p)).toBe(false)
    await prisma.matchingProfile.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } })
    expect(can(await a.c.profile.get())).toBe(true)
  })

  it('lastActiveAt is bumped at most once per hour', async () => {
    const a = await student()
    const p = await a.c.profile.upsert(CORE)
    const old = new Date(Date.now() - 2 * 3_600_000)
    await prisma.matchingProfile.update({ where: { id: p.id }, data: { lastActiveAt: old } })
    await a.c.profile.get()
    const bumped = (await prisma.matchingProfile.findUniqueOrThrow({ where: { id: p.id } })).lastActiveAt
    expect(bumped.getTime()).toBeGreaterThan(Date.now() - 60_000)
    const recent = new Date(Date.now() - 10 * 60_000)
    await prisma.matchingProfile.update({ where: { id: p.id }, data: { lastActiveAt: recent } })
    await a.c.profile.get()
    expect((await prisma.matchingProfile.findUniqueOrThrow({ where: { id: p.id } })).lastActiveAt.getTime()).toBe(recent.getTime())
  })
})

describe('profile.delete and markFound cascades', () => {
  const requestRow = (from: string, to: string, status: 'PENDING' | 'ACCEPTED' = 'PENDING') =>
    prisma.partnerRequest.create({ data: { fromUserId: from, toUserId: to, status, expiresAt: new Date(Date.now() + 14 * 86_400_000) } })

  it('delete cancels pending requests both ways, ends live connections with PROFILE_DELETED, keeps messages', async () => {
    const a = await student()
    const b = await student()
    const c = await student()
    const d = await student()
    for (const s of [a, b, c, d]) await s.c.profile.upsert(CORE)
    const accepted = await requestRow(b.id, a.id, 'ACCEPTED')
    const [lo, hi] = [a.id, b.id].sort() as [string, string]
    const conn = await prisma.partnerConnection.create({ data: { userAId: lo, userBId: hi, requestId: accepted.id } })
    await prisma.partnerMessage.create({ data: { connectionId: conn.id, senderId: b.id, body: 'Halo' } })
    const out = await requestRow(a.id, c.id)
    const inc = await requestRow(d.id, a.id)
    const other = await requestRow(c.id, d.id)

    expect(await a.c.profile.delete()).toEqual({ ok: true })

    expect(await prisma.matchingProfile.findUnique({ where: { userId: a.id } })).toBeNull()
    expect(await prisma.matchingProfile.count()).toBe(3)
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: out.id } })).status).toBe('CANCELLED')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: inc.id } })).status).toBe('CANCELLED')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('PENDING')
    const ended = await prisma.partnerConnection.findUniqueOrThrow({ where: { id: conn.id } })
    expect(ended).toMatchObject({ endReason: 'PROFILE_DELETED', endedById: a.id })
    expect(ended.endedAt).not.toBeNull()
    expect(await prisma.partnerMessage.count({ where: { connectionId: conn.id } })).toBe(1)
  })

  it('markFound pauses the profile and cancels pending requests but keeps connections', async () => {
    const a = await student()
    const b = await student()
    const c = await student()
    for (const s of [a, b, c]) await s.c.profile.upsert(CORE)
    const accepted = await requestRow(b.id, a.id, 'ACCEPTED')
    const [lo, hi] = [a.id, b.id].sort() as [string, string]
    const conn = await prisma.partnerConnection.create({ data: { userAId: lo, userBId: hi, requestId: accepted.id } })
    const pending = await requestRow(c.id, a.id)

    const p = await a.c.profile.markFound()
    expect(p.pausedAt).not.toBeNull()
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('CANCELLED')
    expect((await prisma.partnerConnection.findUniqueOrThrow({ where: { id: conn.id } })).endedAt).toBeNull()
  })
})
