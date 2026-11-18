import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { applyVerification, getStudentVerificationStatus } from '../../src/studentVerification/verifier.ts'
import { newStudent, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const DAY = 86_400_000
const NOW = new Date('2026-11-18T03:00:00Z')
const providers = { microsoft: true, google: false }
const row = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } })
const apply = (id: string, via: 'EMAIL' | 'MICROSOFT' | 'GOOGLE' | 'KTM', days: number, campusShortName?: string) =>
  prisma.$transaction((tx) => applyVerification(tx, id, { via, until: new Date(NOW.getTime() + days * DAY), campusShortName }, NOW))

describe('applyVerification', () => {
  it('writes via, until and campus (only when empty) on a first verification', async () => {
    const s = await newStudent()
    await apply(s.id, 'EMAIL', 365, 'BINUS')
    expect(await row(s.id)).toMatchObject({ campusVerifiedVia: 'EMAIL', campus: 'BINUS', campusEmailVerifiedAt: NOW, campusVerifiedUntil: new Date(NOW.getTime() + 365 * DAY) })
    await apply(s.id, 'EMAIL', 365, 'ITB')
    expect((await row(s.id)).campus).toBe('BINUS')
  })

  it('caps until at now + 365 days', async () => {
    const s = await newStudent()
    await apply(s.id, 'KTM', 900)
    expect((await row(s.id)).campusVerifiedUntil).toEqual(new Date(NOW.getTime() + 365 * DAY))
  })

  it('never shortens: a different, shorter method keeps via/until; same method or longer overwrites', async () => {
    const s = await newStudent()
    await apply(s.id, 'EMAIL', 300)
    await apply(s.id, 'KTM', 100)
    expect(await row(s.id)).toMatchObject({ campusVerifiedVia: 'EMAIL', campusVerifiedUntil: new Date(NOW.getTime() + 300 * DAY) })
    await apply(s.id, 'EMAIL', 100)
    expect((await row(s.id)).campusVerifiedUntil).toEqual(new Date(NOW.getTime() + 100 * DAY))
    await apply(s.id, 'GOOGLE', 200)
    expect(await row(s.id)).toMatchObject({ campusVerifiedVia: 'GOOGLE', campusVerifiedUntil: new Date(NOW.getTime() + 200 * DAY) })
  })

  it('keeps a legacy never-expiring verification against a different method, and writes once expired', async () => {
    const s = await newStudent()
    await prisma.user.update({ where: { id: s.id }, data: { campusEmailVerifiedAt: new Date(NOW.getTime() - DAY), campusVerifiedVia: 'EMAIL', campusVerifiedUntil: null } })
    await apply(s.id, 'KTM', 100)
    expect(await row(s.id)).toMatchObject({ campusVerifiedVia: 'EMAIL', campusVerifiedUntil: null })
    await prisma.user.update({ where: { id: s.id }, data: { campusVerifiedUntil: new Date(NOW.getTime() - DAY) } })
    await apply(s.id, 'KTM', 100)
    expect(await row(s.id)).toMatchObject({ campusVerifiedVia: 'KTM', campusVerifiedUntil: new Date(NOW.getTime() + 100 * DAY) })
  })
})

describe('getStudentVerificationStatus', () => {
  const status = (id: string, now = NOW) => getStudentVerificationStatus(prisma, id, now, providers)
  const doc = (userId: string, s: 'PENDING' | 'REJECTED' | 'APPROVED', createdAt: Date, extra: Record<string, unknown> = {}) =>
    prisma.studentDocument.create({ data: { userId, key: `private/ktm/${userId}/${createdAt.getTime()}`, contentType: 'image/jpeg', status: s, consentAt: createdAt, createdAt, ...extra } })

  it('walks NONE, PENDING, REJECTED, NONE (deleted), VERIFIED, EXPIRED', async () => {
    const s = await newStudent()
    expect(await status(s.id)).toMatchObject({ state: 'NONE', via: null, until: null, reason: null, providers })
    const d = await doc(s.id, 'PENDING', new Date(NOW.getTime() - 2 * DAY))
    expect((await status(s.id)).state).toBe('PENDING')
    await prisma.studentDocument.update({ where: { id: d.id }, data: { status: 'REJECTED', reason: 'Foto buram' } })
    expect(await status(s.id)).toMatchObject({ state: 'REJECTED', reason: 'Foto buram' })
    await prisma.studentDocument.update({ where: { id: d.id }, data: { deletedAt: NOW } })
    expect((await status(s.id)).state).toBe('NONE')
    await apply(s.id, 'MICROSOFT', 100, 'BINUS')
    expect(await status(s.id)).toMatchObject({ state: 'VERIFIED', via: 'MICROSOFT', campus: 'BINUS', until: new Date(NOW.getTime() + 100 * DAY).toISOString() })
    expect(await status(s.id, new Date(NOW.getTime() + 101 * DAY))).toMatchObject({ state: 'EXPIRED', via: 'MICROSOFT' })
  })

  it('a rejected document older than a verification does not make the state REJECTED', async () => {
    const s = await newStudent()
    await doc(s.id, 'REJECTED', new Date(NOW.getTime() - 5 * DAY), { reason: 'x' })
    await apply(s.id, 'EMAIL', 10)
    expect((await status(s.id, new Date(NOW.getTime() + 11 * DAY))).state).toBe('EXPIRED')
  })
})
