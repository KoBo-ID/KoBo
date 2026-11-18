import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { purgeUnverifiedUsers } from '../../src/unverifiedCleanup.ts'
import { prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const DAY = 86_400_000
const now = new Date()
const mk = (email: string, daysOld: number, extra: { emailVerified?: boolean; isDemo?: boolean } = {}) =>
  prisma.user.create({ data: { name: email, email, emailVerified: extra.emailVerified ?? false, isDemo: extra.isDemo ?? false, createdAt: new Date(now.getTime() - daysOld * DAY) } })
const exists = async (email: string) => (await prisma.user.count({ where: { email } })) === 1

describe('purgeUnverifiedUsers', () => {
  it('deletes an 8-day-old unverified account with its sessions and accounts, and returns the count', async () => {
    const old = await mk('old@example.com', 8)
    await prisma.account.create({ data: { userId: old.id, accountId: old.id, providerId: 'credential', password: 'x' } })
    await prisma.session.create({ data: { userId: old.id, token: 't-old', expiresAt: new Date(now.getTime() + DAY) } })
    expect(await purgeUnverifiedUsers(prisma, now)).toBe(1)
    expect(await exists('old@example.com')).toBe(false)
    expect(await prisma.account.count({ where: { userId: old.id } })).toBe(0)
    expect(await prisma.session.count({ where: { userId: old.id } })).toBe(0)
  })

  it('keeps a 6-day-old unverified, a verified, a demo and an owner-profile account', async () => {
    await mk('fresh@example.com', 6)
    await mk('verified@example.com', 30, { emailVerified: true })
    await mk('demo@example.com', 30, { isDemo: true })
    const owner = await mk('owner@example.com', 30)
    await prisma.ownerProfile.create({ data: { userId: owner.id } })
    expect(await purgeUnverifiedUsers(prisma, now)).toBe(0)
    for (const e of ['fresh', 'verified', 'demo', 'owner']) expect(await exists(`${e}@example.com`), e).toBe(true)
  })

  it('keeps an old unverified account that still has a stored KTM (the object would be orphaned)', async () => {
    const u = await mk('doc@example.com', 30)
    await prisma.studentDocument.create({ data: { userId: u.id, key: 'k', contentType: 'image/jpeg', consentAt: new Date() } })
    expect(await purgeUnverifiedUsers(prisma, now)).toBe(0)
    expect(await exists('doc@example.com')).toBe(true)
  })
})
