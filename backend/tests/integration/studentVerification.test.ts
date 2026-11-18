import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { approveDocument, rejectDocument } from '../../src/studentVerification/review.ts'
import { callerFor, DEMO_STUDENT_ID, newStudent, prisma, storage } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const code = async (p: Promise<unknown>) => (await err(p))?.code

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
const HTML = new TextEncoder().encode('<html><script>alert(1)</script>')

async function campusId() {
  return (await prisma.campus.findFirstOrThrow({ orderBy: { id: 'asc' } })).id
}
const confirmInput = async (key: string) => ({ key, campusId: await campusId(), nim: '2501234567', nameOnCard: 'Tester Satu', consent: true as const })

/** presign + fake upload, returning the key. */
async function upload(userId: string, bytes: Uint8Array = JPEG, contentType: 'image/jpeg' | 'image/webp' = 'image/jpeg') {
  const p = await callerFor(userId).studentVerification.ktmPresign({ contentType, contentLength: bytes.byteLength })
  storage.putPrivate(p.key, bytes, contentType)
  return p.key
}
async function submit(userId: string) {
  const key = await upload(userId)
  const status = await callerFor(userId).studentVerification.ktmConfirm(await confirmInput(key))
  const doc = await prisma.studentDocument.findFirstOrThrow({ where: { userId, key } })
  return { key, status, doc }
}

describe('studentVerification.ktmPresign', () => {
  it('issues a key under private/ktm/<userId>/ and enforces the type and size limits', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    const p = await c.studentVerification.ktmPresign({ contentType: 'image/jpeg', contentLength: 1000 })
    expect(p.key).toMatch(new RegExp(`^private/ktm/${s.id}/[0-9a-f-]{36}\\.jpg$`))
    expect(p.headers['Content-Type']).toBe('image/jpeg')
    expect((await c.studentVerification.ktmPresign({ contentType: 'image/webp', contentLength: 3_000_000 })).key).toMatch(/\.webp$/)
    expect(await code(c.studentVerification.ktmPresign({ contentType: 'image/jpeg', contentLength: 3_000_001 }))).toBe('BAD_REQUEST')
    expect(await code(c.studentVerification.ktmPresign({ contentType: 'image/jpeg', contentLength: 0 }))).toBe('BAD_REQUEST')
    expect(await code(c.studentVerification.ktmPresign({ contentType: 'image/gif' as never, contentLength: 10 }))).toBe('BAD_REQUEST')
  })

  it('refuses demo users, verified users and users with a PENDING document', async () => {
    const input = { contentType: 'image/jpeg' as const, contentLength: 100 }
    expect(await code(callerFor(DEMO_STUDENT_ID, { isDemo: true }).studentVerification.ktmPresign(input))).toBe('FORBIDDEN')

    const v = await newStudent()
    const now = new Date()
    await prisma.user.update({ where: { id: v.id }, data: { campusEmailVerifiedAt: now, campusVerifiedVia: 'EMAIL', campusVerifiedUntil: new Date(now.getTime() + 86_400_000 * 30) } })
    const e = await err(callerFor(v.id).studentVerification.ktmPresign(input))
    expect([e?.code, e?.message]).toEqual(['PRECONDITION_FAILED', 'Status mahasiswa Anda sudah terverifikasi.'])

    const p = await newStudent()
    await submit(p.id)
    const e2 = await err(callerFor(p.id).studentVerification.ktmPresign(input))
    expect([e2?.code, e2?.message]).toEqual(['CONFLICT', 'KTM Anda sedang ditinjau.'])
  })

  it('lets an expired user upload again', async () => {
    const s = await newStudent()
    await prisma.user.update({ where: { id: s.id }, data: { campusEmailVerifiedAt: new Date('2025-01-01'), campusVerifiedVia: 'EMAIL', campusVerifiedUntil: new Date('2025-06-01') } })
    expect((await callerFor(s.id).studentVerification.ktmPresign({ contentType: 'image/jpeg', contentLength: 100 })).key).toBeTruthy()
  })
})

describe('studentVerification.ktmConfirm', () => {
  it('refuses another user\'s key and leaves the object alone', async () => {
    const a = await newStudent()
    const b = await newStudent()
    const key = await upload(a.id)
    expect(await code(callerFor(b.id).studentVerification.ktmConfirm(await confirmInput(key)))).toBe('FORBIDDEN')
    expect(await code(callerFor(b.id).studentVerification.ktmConfirm(await confirmInput(`private/ktm/${b.id}/../${a.id}/x.jpg`)))).toBe('FORBIDDEN')
    expect(storage.hasPrivate(key)).toBe(true)
    expect(await prisma.studentDocument.count()).toBe(0)
  })

  it('refuses a missing object, an unknown campus and no consent', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    const missing = `private/ktm/${s.id}/00000000-0000-0000-0000-000000000000.jpg`
    expect(await code(c.studentVerification.ktmConfirm(await confirmInput(missing)))).toBe('BAD_REQUEST')
    const key = await upload(s.id)
    expect(await code(c.studentVerification.ktmConfirm({ ...(await confirmInput(key)), campusId: 'nope' }))).toBe('BAD_REQUEST')
    expect(await code(c.studentVerification.ktmConfirm({ ...(await confirmInput(key)), consent: false as never }))).toBe('BAD_REQUEST')
    expect(await prisma.studentDocument.count()).toBe(0)
  })

  it('refuses a bad signature and deletes the object', async () => {
    const s = await newStudent()
    const key = await upload(s.id, HTML)
    expect(await code(callerFor(s.id).studentVerification.ktmConfirm(await confirmInput(key)))).toBe('BAD_REQUEST')
    expect(storage.hasPrivate(key)).toBe(false)
    expect(await prisma.studentDocument.count()).toBe(0)
  })

  it('refuses an oversize or wrongly typed object and deletes it', async () => {
    const s = await newStudent()
    const big = new Uint8Array(3_000_001)
    big.set(JPEG)
    const k1 = `private/ktm/${s.id}/33333333-3333-3333-3333-333333333333.jpg`
    storage.putPrivate(k1, big, 'image/jpeg')
    expect(await code(callerFor(s.id).studentVerification.ktmConfirm(await confirmInput(k1)))).toBe('BAD_REQUEST')
    expect(storage.hasPrivate(k1)).toBe(false)
    const k2 = `private/ktm/${s.id}/11111111-1111-1111-1111-111111111111.jpg`
    storage.putPrivate(k2, JPEG, 'image/gif')
    expect(await code(callerFor(s.id).studentVerification.ktmConfirm(await confirmInput(k2)))).toBe('BAD_REQUEST')
    expect(storage.hasPrivate(k2)).toBe(false)
  })

  it('creates a PENDING document, never returns the key, and refuses a second PENDING', async () => {
    const s = await newStudent()
    const { key, status, doc } = await submit(s.id)
    expect(doc).toMatchObject({ kind: 'KTM', status: 'PENDING', nim: '2501234567', nameOnCard: 'Tester Satu', contentType: 'image/jpeg' })
    expect(doc.consentAt).toBeInstanceOf(Date)
    expect(status.state).toBe('PENDING')
    expect(JSON.stringify(status)).not.toContain(key)
    expect(JSON.stringify(status)).not.toContain('private/')

    const second = `private/ktm/${s.id}/44444444-4444-4444-4444-444444444444.jpg`
    storage.putPrivate(second, JPEG, 'image/jpeg')
    // The presign already refuses; a direct confirm hits the one-PENDING index.
    expect(await code(callerFor(s.id).studentVerification.ktmConfirm(await confirmInput(second)))).toBe('CONFLICT')
    expect(await prisma.studentDocument.count({ where: { userId: s.id } })).toBe(1)
  })

  it('refuses demo users', async () => {
    const key = `private/ktm/${DEMO_STUDENT_ID}/22222222-2222-2222-2222-222222222222.jpg`
    expect(await code(callerFor(DEMO_STUDENT_ID, { isDemo: true }).studentVerification.ktmConfirm(await confirmInput(key)))).toBe('FORBIDDEN')
  })
})

describe('studentVerification.status', () => {
  it('shows only the caller\'s own state and never a key', async () => {
    const a = await newStudent()
    const b = await newStudent()
    const { key } = await submit(a.id)
    const sb = await callerFor(b.id).studentVerification.status()
    expect(sb.state).toBe('NONE')
    expect(sb.reason).toBeNull()
    const sa = await callerFor(a.id).studentVerification.status()
    expect(sa.state).toBe('PENDING')
    expect(JSON.stringify([sa, sb])).not.toContain(key)
  })
})

describe('studentVerification.ktmWithdraw', () => {
  it('deletes the object and closes a PENDING document', async () => {
    const s = await newStudent()
    const { key, doc } = await submit(s.id)
    const status = await callerFor(s.id).studentVerification.ktmWithdraw()
    expect(storage.hasPrivate(key)).toBe(false)
    const row = await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(row).toMatchObject({ status: 'REJECTED', reason: 'Ditarik oleh pengguna' })
    expect(row.deletedAt).toBeInstanceOf(Date)
    expect(row.decidedAt).toBeInstanceOf(Date)
    expect(status.state).toBe('NONE')
    // Can upload again afterwards.
    expect((await callerFor(s.id).studentVerification.ktmPresign({ contentType: 'image/jpeg', contentLength: 100 })).key).toBeTruthy()
  })

  it('deletes the photo of a decided document without changing its status, and is a no-op with nothing', async () => {
    const s = await newStudent()
    const { key, doc } = await submit(s.id)
    await rejectDocument(prisma, doc.id, { reviewer: 'op', reason: 'Buram' })
    await callerFor(s.id).studentVerification.ktmWithdraw()
    expect(storage.hasPrivate(key)).toBe(false)
    expect(await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ status: 'REJECTED', reason: 'Buram' })
    await expect(callerFor(s.id).studentVerification.ktmWithdraw()).resolves.toBeTruthy()
  })
})

describe('review: approve and reject', () => {
  const NOW = new Date('2026-11-18T03:00:00.000Z')
  const ymd = (days: number) => new Date(NOW.getTime() + days * 86_400_000 + 7 * 3_600_000).toISOString().slice(0, 10)

  it('approve verifies the user via KTM until the end of the chosen day, and sets the retention date', async () => {
    const s = await newStudent()
    const { doc } = await submit(s.id)
    const day = ymd(200)
    const r = await approveDocument(prisma, doc.id, { reviewer: 'op', validUntil: day }, NOW)
    expect(r.until.toISOString()).toBe(new Date(`${day}T23:59:59.999+07:00`).toISOString())
    const u = await prisma.user.findUniqueOrThrow({ where: { id: s.id } })
    expect(u).toMatchObject({ campusVerifiedVia: 'KTM' })
    expect(u.campusVerifiedUntil?.getTime()).toBe(r.until.getTime())
    expect(u.campusEmailVerifiedAt).toEqual(NOW)
    const row = await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(row).toMatchObject({ status: 'APPROVED', reviewer: 'op' })
    expect(row.deleteAfter?.getTime()).toBe(NOW.getTime() + 30 * 86_400_000)
    const status = await callerFor(s.id).studentVerification.status()
    expect(status).toMatchObject({ state: 'VERIFIED', via: 'KTM' })
  })

  it('refuses a past date, a date over 365 days away, a bad format, and deciding twice', async () => {
    const s = await newStudent()
    const { doc } = await submit(s.id)
    await expect(approveDocument(prisma, doc.id, { reviewer: 'op', validUntil: ymd(-1) }, NOW)).rejects.toThrow()
    await expect(approveDocument(prisma, doc.id, { reviewer: 'op', validUntil: ymd(366) }, NOW)).rejects.toThrow()
    await expect(approveDocument(prisma, doc.id, { reviewer: 'op', validUntil: '18-11-2027' }, NOW)).rejects.toThrow()
    expect(await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({ status: 'PENDING' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).campusVerifiedVia).toBeNull()
    await approveDocument(prisma, doc.id, { reviewer: 'op', validUntil: ymd(100) }, NOW)
    await expect(approveDocument(prisma, doc.id, { reviewer: 'op', validUntil: ymd(100) }, NOW)).rejects.toThrow()
    await expect(rejectDocument(prisma, doc.id, { reviewer: 'op', reason: 'x' }, NOW)).rejects.toThrow()
  })

  it('reject needs a reason, stores it and shows it in the status', async () => {
    const s = await newStudent()
    const { doc } = await submit(s.id)
    await expect(rejectDocument(prisma, doc.id, { reviewer: 'op', reason: '  ' }, NOW)).rejects.toThrow()
    await rejectDocument(prisma, doc.id, { reviewer: 'op', reason: 'Foto buram' }, NOW)
    const row = await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })
    expect(row).toMatchObject({ status: 'REJECTED', reason: 'Foto buram', reviewer: 'op' })
    expect(row.deleteAfter?.getTime()).toBe(NOW.getTime() + 30 * 86_400_000)
    expect(await callerFor(s.id).studentVerification.status()).toMatchObject({ state: 'REJECTED', reason: 'Foto buram' })
  })
})
