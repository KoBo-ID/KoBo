// C-08: KTM WebP confirm, ktmPresign rate limit, APPROVED retention, deleted-document review, students:review CLI.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { RateLimiter } from '../../src/rateLimit.ts'
import { purgeStudentDocuments } from '../../src/studentDocRetention.ts'
import { approveDocument, rejectDocument, ReviewError, showDocument } from '../../src/studentVerification/review.ts'
import { callerFor, newStudent, prisma, storage } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DAY = 86_400_000
const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

const campusId = async () => (await prisma.campus.findFirstOrThrow({ orderBy: { id: 'asc' } })).id
const confirmInput = async (key: string) => ({ key, campusId: await campusId(), nim: '2501234567', nameOnCard: 'Tester Satu', consent: true as const })

async function pendingDoc(userId: string, tag = 'a') {
  const key = `private/ktm/${userId}/${tag}.jpg`
  storage.putPrivate(key, JPEG, 'image/jpeg')
  return prisma.studentDocument.create({ data: { userId, key, contentType: 'image/jpeg', campusId: await campusId(), nim: '2501234567', nameOnCard: 'Tester', consentAt: new Date() } })
}

function runCli(args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/review-students.ts', ...args], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, REVIEWER: 'tester' },
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

describe('ktmConfirm with WebP', () => {
  it('files a PENDING document for a real WebP and records its content type', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    const p = await c.studentVerification.ktmPresign({ contentType: 'image/webp', contentLength: WEBP.byteLength })
    expect(p.key).toMatch(/\.webp$/)
    storage.putPrivate(p.key, WEBP, 'image/webp')
    const status = await c.studentVerification.ktmConfirm(await confirmInput(p.key))
    expect(status.state).toBe('PENDING')
    expect(await prisma.studentDocument.findFirstOrThrow({ where: { userId: s.id } })).toMatchObject({ key: p.key, contentType: 'image/webp', status: 'PENDING' })
  })

  it('refuses JPEG bytes stored as image/webp and deletes the object', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    const p = await c.studentVerification.ktmPresign({ contentType: 'image/webp', contentLength: JPEG.byteLength })
    storage.putPrivate(p.key, JPEG, 'image/webp')
    expect((await err(c.studentVerification.ktmConfirm(await confirmInput(p.key))))?.code).toBe('BAD_REQUEST')
    expect(storage.hasPrivate(p.key)).toBe(false)
    expect(await prisma.studentDocument.count({ where: { userId: s.id } })).toBe(0)
  })
})

describe('ktmPresign rate limit', () => {
  it('allows 10 per hour per user, then answers TOO_MANY_REQUESTS; other users and later windows are unaffected', async () => {
    const clock = { t: 1_800_000_000_000 }
    const limiter = new RateLimiter({ enabled: true, now: () => clock.t })
    const a = await newStudent()
    const b = await newStudent()
    const input = { contentType: 'image/jpeg' as const, contentLength: 100 }
    const ca = callerFor(a.id, { limiter })
    for (let i = 0; i < 10; i++) expect(await err(ca.studentVerification.ktmPresign(input)), `call ${i + 1}`).toBeNull()
    const e = await err(ca.studentVerification.ktmPresign(input))
    expect([e?.code, e?.message]).toEqual(['TOO_MANY_REQUESTS', 'Terlalu banyak unggahan KTM. Coba lagi dalam satu jam.'])
    expect(await err(callerFor(b.id, { limiter }).studentVerification.ktmPresign(input))).toBeNull()
    clock.t += 60 * 60 * 1000 + 1
    expect(await err(ca.studentVerification.ktmPresign(input))).toBeNull()
  })
})

describe('retention of APPROVED documents', () => {
  it('purges an approved KTM photo 30 days after the decision but keeps the student verified', async () => {
    const s = await newStudent()
    const doc = await pendingDoc(s.id)
    const now = new Date('2026-12-01T05:00:00.000Z')
    await approveDocument(prisma, doc.id, { reviewer: 'tester', validUntil: '2027-03-01' }, now)
    const approved = await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(approved.status).toBe('APPROVED')
    expect(approved.deleteAfter?.toISOString()).toBe(new Date(now.getTime() + 30 * DAY).toISOString())

    expect(await purgeStudentDocuments(prisma, storage, new Date(now.getTime() + 29 * DAY))).toBe(0)
    expect(storage.hasPrivate(doc.key)).toBe(true)
    expect(await purgeStudentDocuments(prisma, storage, new Date(now.getTime() + 31 * DAY))).toBe(1)
    expect(storage.hasPrivate(doc.key)).toBe(false)
    expect((await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })).deletedAt).not.toBeNull()
    const user = await prisma.user.findUniqueOrThrow({ where: { id: s.id } })
    expect(user.campusVerifiedVia).toBe('KTM')
    expect(user.campusVerifiedUntil).not.toBeNull()
  })
})

describe('review of a deleted document', () => {
  it('refuses show, approve and reject once the photo is deleted', async () => {
    const s = await newStudent()
    const doc = await pendingDoc(s.id)
    await prisma.studentDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } })
    await expect(showDocument(prisma, storage, doc.id)).rejects.toBeInstanceOf(ReviewError)
    await expect(approveDocument(prisma, doc.id, { reviewer: 't', validUntil: addDays(todayWIB(new Date()), 30) })).rejects.toBeInstanceOf(ReviewError)
    await expect(rejectDocument(prisma, doc.id, { reviewer: 't', reason: 'x' })).rejects.toBeInstanceOf(ReviewError)
    expect((await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('PENDING')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).campusVerifiedVia).toBeNull()
  })
})

describe('students:review CLI', () => {
  it('lists pending, approves with a date, and rejects with a reason', async () => {
    const a = await newStudent()
    const b = await newStudent()
    const da = await pendingDoc(a.id)
    const db = await pendingDoc(b.id, 'b')

    const listed = runCli(['list'])
    expect(listed.status).toBe(0)
    expect(listed.out).toContain(da.id)
    expect(listed.out).toContain(db.id)

    const approved = runCli(['approve', da.id, addDays(todayWIB(new Date()), 60)])
    expect(approved.status).toBe(0)
    expect(approved.out).toContain(`Approved ${da.id}`)
    expect(await prisma.studentDocument.findUniqueOrThrow({ where: { id: da.id } })).toMatchObject({ status: 'APPROVED', reviewer: 'tester' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).campusVerifiedVia).toBe('KTM')

    const rejected = runCli(['reject', db.id, 'Foto buram'])
    expect(rejected.status).toBe(0)
    expect(await prisma.studentDocument.findUniqueOrThrow({ where: { id: db.id } })).toMatchObject({ status: 'REJECTED', reason: 'Foto buram' })
    expect(runCli(['list']).out).not.toContain(da.id)
  })

  it('exits 1 for a bad, past or far date, an unknown or deleted document, and 2 on bad usage', async () => {
    const s = await newStudent()
    const doc = await pendingDoc(s.id)
    expect(runCli(['approve', doc.id, '2026-02-31']).status).toBe(1)
    expect(runCli(['approve', doc.id, addDays(todayWIB(new Date()), 400)]).status).toBe(1)
    expect(runCli(['approve', doc.id, '2020-01-01']).status).toBe(1)
    expect(runCli(['approve', 'no-such-id', addDays(todayWIB(new Date()), 30)]).status).toBe(1)
    expect((await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('PENDING')

    await prisma.studentDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } })
    const shown = runCli(['show', doc.id])
    expect(shown.status).toBe(1)
    expect(shown.out).toContain('sudah dihapus')

    expect(runCli([]).status).toBe(2)
    expect(runCli(['approve', doc.id]).status).toBe(2)
  })
})
