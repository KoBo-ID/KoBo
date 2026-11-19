import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { demoIsolationOn } from '../../src/demoIsolation.ts'
import { resetDb } from '../../src/db/seed.ts'
import { authEnv } from '../../src/env.ts'
import { storageFromEnv } from '../../src/storage.ts'
import { approveDocument, ReviewError } from '../../src/studentVerification/review.ts'
import { callerFor, newStudent, prisma, request, nextIp, registerAndSignIn, secret, storage } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const NOW = new Date('2026-11-19T03:00:00.000Z')
const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

const campusId = async () => (await prisma.campus.findFirstOrThrow({ orderBy: { id: 'asc' } })).id
const confirmInput = async (key: string) => ({ key, campusId: await campusId(), nim: '2501234567', nameOnCard: 'Tester Satu', consent: true as const })

async function upload(userId: string) {
  const p = await callerFor(userId).studentVerification.ktmPresign({ contentType: 'image/jpeg', contentLength: JPEG.byteLength })
  storage.putPrivate(p.key, JPEG, 'image/jpeg')
  return p.key
}
async function seedDoc(userId: string, status: 'PENDING' | 'REJECTED' | 'APPROVED') {
  const key = `private/ktm/${userId}/${crypto.randomUUID()}.jpg`
  storage.putPrivate(key, JPEG, 'image/jpeg')
  return prisma.studentDocument.create({ data: { userId, key, contentType: 'image/jpeg', status, consentAt: NOW } })
}

describe('B-03 ktmWithdraw vs approveDocument', () => {
  it('never leaves a verified student with a REJECTED document, however the two calls interleave', async () => {
    for (let i = 0; i < 12; i++) {
      const s = await newStudent()
      const doc = await seedDoc(s.id, 'PENDING')
      const [w] = await Promise.allSettled([callerFor(s.id).studentVerification.ktmWithdraw(), approveDocument(prisma, doc.id, { reviewer: 'op', validUntil: '2027-01-31' }, new Date())])
      expect(w.status).toBe('fulfilled')
      const after = await prisma.studentDocument.findUniqueOrThrow({ where: { id: doc.id } })
      const user = await prisma.user.findUniqueOrThrow({ where: { id: s.id } })
      if (user.campusVerifiedVia === 'KTM') expect(after.status, `round ${i}`).toBe('APPROVED')
      else expect(after.status, `round ${i}`).toBe('REJECTED')
      expect(after.deletedAt).not.toBeNull()
      expect(await storage.headPrivate(doc.key)).toBeNull()
    }
  })

  it('removes every stored photo of the user, not only the newest', async () => {
    const s = await newStudent()
    const old = await seedDoc(s.id, 'REJECTED')
    const pending = await seedDoc(s.id, 'PENDING')
    await callerFor(s.id).studentVerification.ktmWithdraw()
    for (const d of [old, pending]) {
      expect(await storage.headPrivate(d.key)).toBeNull()
      expect((await prisma.studentDocument.findUniqueOrThrow({ where: { id: d.id } })).deletedAt).not.toBeNull()
    }
  })
})

describe('A-009 ktmConfirm', () => {
  it('refuses an already verified student and deletes the uploaded object', async () => {
    const s = await newStudent()
    const key = await upload(s.id)
    await prisma.user.update({ where: { id: s.id }, data: { campusEmailVerifiedAt: new Date(), campusVerifiedVia: 'EMAIL', campusVerifiedUntil: new Date(Date.now() + 86_400_000 * 30) } })
    const e = await err(callerFor(s.id).studentVerification.ktmConfirm(await confirmInput(key)))
    expect(e?.code).toBe('PRECONDITION_FAILED')
    expect(await storage.headPrivate(key)).toBeNull()
    expect(await prisma.studentDocument.count({ where: { userId: s.id } })).toBe(0)
  })

  it('deletes the new object when a PENDING document already exists, but never a key another document owns', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    const k1 = await upload(s.id)
    await c.studentVerification.ktmConfirm(await confirmInput(k1))
    const k2 = `private/ktm/${s.id}/${crypto.randomUUID()}.jpg`
    storage.putPrivate(k2, JPEG, 'image/jpeg')
    expect((await err(c.studentVerification.ktmConfirm(await confirmInput(k2))))?.code).toBe('CONFLICT')
    expect(await storage.headPrivate(k2)).toBeNull()
    // Replaying the first (live) key must not delete its photo.
    expect((await err(c.studentVerification.ktmConfirm(await confirmInput(k1))))?.code).toBe('CONFLICT')
    expect(await storage.headPrivate(k1)).not.toBeNull()
  })
})

describe('B-07 approval date', () => {
  it('refuses a day that does not exist', async () => {
    const s = await newStudent()
    const doc = await seedDoc(s.id, 'PENDING')
    await expect(approveDocument(prisma, doc.id, { reviewer: 'op', validUntil: '2026-11-31' }, NOW)).rejects.toBeInstanceOf(ReviewError)
    await expect(approveDocument(prisma, doc.id, { reviewer: 'op', validUntil: '2027-02-29' }, NOW)).rejects.toBeInstanceOf(ReviewError)
    await expect(approveDocument(prisma, doc.id, { reviewer: 'op', validUntil: '2027-01-31' }, NOW)).resolves.toMatchObject({ userId: s.id })
  })
})

describe('B-09 sign-up validates phone and campus', () => {
  const up = (extra: Record<string, unknown>) => request('/api/auth/sign-up/email', { body: { name: 'Sari', email: `s${Math.random().toString(36).slice(2)}@example.com`, password: 'Sandi-rahasia-123', ...extra } })
  it('rejects a bad phone or an over-long campus, accepts good ones', async () => {
    expect((await up({ phone: 'abc' })).status).toBe(400)
    expect((await up({ campus: 'x'.repeat(81) })).status).toBe(400)
    expect((await up({ phone: '0812 3456 7890', campus: 'Binus' })).status).toBe(200)
  })
})

describe('B-11 concurrent campus-email requests', () => {
  it('leave exactly one live challenge', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    const rs = await Promise.all(
      [0, 1, 2].map((i) => request('/api/auth/campus-email/request', { cookie, ip: nextIp(), body: { email: `sari${i}@binus.ac.id` } })),
    )
    expect(rs.every((r) => r.status === 200)).toBe(true)
    expect(await prisma.campusEmailChallenge.count({ where: { consumedAt: null } })).toBe(1)
    expect(await prisma.emailOutbox.count({ where: { template: 'campus-email' } })).toBe(3)
  })
})

describe('B-12 env and storage', () => {
  it('refuses a short BETTER_AUTH_SECRET in production only', () => {
    const base = { BETTER_AUTH_URL: 'https://kobo.example' }
    expect(() => authEnv({ ...base, NODE_ENV: 'production', BETTER_AUTH_SECRET: 'x'.repeat(31) })).toThrow(/BETTER_AUTH_SECRET/)
    expect(authEnv({ ...base, NODE_ENV: 'production', BETTER_AUTH_SECRET: secret }).secret).toBe(secret)
    expect(authEnv({ BETTER_AUTH_URL: 'http://localhost:5173', NODE_ENV: 'development', BETTER_AUTH_SECRET: 'short' }).secret).toBe('short')
  })
  it('refuses the same bucket for public and private', () => {
    const r2 = { R2_ENDPOINT: 'https://x.r2.example', R2_PUBLIC_BUCKET: 'same', R2_PUBLIC_ACCESS_KEY_ID: 'a', R2_PUBLIC_SECRET_ACCESS_KEY: 'b', R2_PUBLIC_BASE_URL: 'https://cdn.example' }
    const priv = { R2_PRIVATE_ACCESS_KEY_ID: 'c', R2_PRIVATE_SECRET_ACCESS_KEY: 'd' }
    expect(() => storageFromEnv({ ...r2, ...priv, R2_PRIVATE_BUCKET: 'same' })).toThrow(/R2_PRIVATE_BUCKET/)
    expect(() => storageFromEnv({ ...r2, ...priv, R2_PRIVATE_BUCKET: 'other' })).not.toThrow()
  })
})

describe('B-01 DEMO_ISOLATION fails closed in production', () => {
  it('is on in production unless explicitly 0; dev and test keep opt-in', () => {
    expect(demoIsolationOn({ NODE_ENV: 'production' })).toBe(true)
    expect(demoIsolationOn({ NODE_ENV: 'production', DEMO_ISOLATION: '1' })).toBe(true)
    expect(demoIsolationOn({ NODE_ENV: 'production', DEMO_ISOLATION: '0' })).toBe(false)
    expect(demoIsolationOn({ NODE_ENV: 'development' })).toBe(false)
    expect(demoIsolationOn({ NODE_ENV: 'test' })).toBe(false)
    expect(demoIsolationOn({ NODE_ENV: 'test', DEMO_ISOLATION: '1' })).toBe(true)
  })
})
