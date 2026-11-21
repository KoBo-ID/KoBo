// R3-A4: KTM flow with SheerID-like timing: 3-attempt limit, status extras, reject codes, decision emails, auto-review.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { renderEmail } from '../../src/emailTemplates.ts'
import { ktmAutoReviewSeconds } from '../../src/env.ts'
import { autoReviewKtm } from '../../src/studentVerification/ktmAutoReview.ts'
import { KTM_REJECT_REASONS, rejectDocument, resetKtmAttempts } from '../../src/studentVerification/review.ts'
import { callerFor, newStudent, prisma, storage } from '../helpers.ts'

beforeEach(() => resetDb(prisma))
afterEach(() => {
  delete process.env.KTM_AUTO_REVIEW_SECONDS
})

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
const NOW = new Date('2026-11-21T03:00:00Z')

const campus = () => prisma.campus.findFirstOrThrow({ orderBy: { id: 'asc' } })
async function doc(userId: string, tag: string, extra: Record<string, unknown> = {}) {
  const key = `private/ktm/${userId}/${tag}.jpg`
  storage.putPrivate(key, JPEG, 'image/jpeg')
  return prisma.studentDocument.create({ data: { userId, key, contentType: 'image/jpeg', campusId: (await campus()).id, nim: '2501234567', nameOnCard: 'Tester', consentAt: NOW, createdAt: NOW, ...extra } })
}
const reject = (id: string, reason = 'FOTO_BURAM') => rejectDocument(prisma, id, { reviewer: 'op', reason }, NOW)
async function confirm(userId: string, extra: Record<string, unknown> = {}) {
  const c = callerFor(userId)
  const p = await c.studentVerification.ktmPresign({ contentType: 'image/jpeg', contentLength: JPEG.byteLength })
  storage.putPrivate(p.key, JPEG, 'image/jpeg')
  return c.studentVerification.ktmConfirm({ key: p.key, campusId: (await campus()).id, nim: '2501234567', nameOnCard: 'Tester Satu', consent: true as const, ...extra })
}
const mails = (to: string) => prisma.emailOutbox.findMany({ where: { to }, orderBy: { createdAt: 'asc' } })

describe('ktmConfirm', () => {
  it('stores claimedValidUntil and program, and refuses a past validUntil', async () => {
    const s = await newStudent()
    const future = addDays(todayWIB(new Date()), 200)
    const status = await confirm(s.id, { validUntil: future, program: 'Teknik Informatika' })
    expect(status.state).toBe('PENDING')
    expect(await prisma.studentDocument.findFirstOrThrow({ where: { userId: s.id } })).toMatchObject({ program: 'Teknik Informatika', claimedValidUntil: new Date(`${future}T00:00:00.000Z`) })

    const o = await newStudent()
    const e = await err(confirm(o.id, { validUntil: '2020-01-01' }))
    expect(e?.code).toBe('BAD_REQUEST')
    expect(await prisma.studentDocument.count({ where: { userId: o.id } })).toBe(0)
  })

  it('allows 3 rejections, then refuses with the Cara lain message and deletes the unowned object', async () => {
    const s = await newStudent()
    for (const t of ['a', 'b', 'c']) await reject((await doc(s.id, t)).id)
    const c = callerFor(s.id)
    expect((await err(c.studentVerification.ktmPresign({ contentType: 'image/jpeg', contentLength: 16 })))?.message).toMatch(/Cara lain/)
    const key = `private/ktm/${s.id}/new.jpg`
    storage.putPrivate(key, JPEG, 'image/jpeg')
    const e = await err(c.studentVerification.ktmConfirm({ key, campusId: (await campus()).id, nim: '2501234567', nameOnCard: 'Tester Satu', consent: true }))
    expect(e?.message).toMatch(/Cara lain/)
    expect(e?.message).toMatch(/hubungi KoBo/)
    expect(storage.hasPrivate(key)).toBe(false)
  })

  it('a withdrawn document does not count; reset gives the attempts back', async () => {
    const s = await newStudent()
    await doc(s.id, 'w', { status: 'REJECTED', reason: 'Ditarik oleh pengguna' })
    expect((await callerFor(s.id).studentVerification.status()).attemptsLeft).toBe(3)
    for (const t of ['a', 'b', 'c']) await reject((await doc(s.id, t)).id)
    expect((await callerFor(s.id).studentVerification.status()).attemptsLeft).toBe(0)
    expect(await resetKtmAttempts(prisma, s.id)).toBe(3)
    expect((await callerFor(s.id).studentVerification.status()).attemptsLeft).toBe(3)
    expect((await confirm(s.id)).state).toBe('PENDING')
  })
})

describe('status extras', () => {
  it('attemptsLeft counts down, submittedAt is the pending createdAt, slaText follows KTM_AUTO_REVIEW_SECONDS', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    expect(await c.studentVerification.status()).toMatchObject({ state: 'NONE', attemptsLeft: 3, submittedAt: null, slaText: 'Biasanya selesai dalam 1×24 jam' })
    const d1 = await doc(s.id, 'a', { createdAt: new Date('2026-11-20T01:00:00Z') })
    expect(await c.studentVerification.status()).toMatchObject({ state: 'PENDING', submittedAt: '2026-11-20T01:00:00.000Z', attemptsLeft: 3 })
    await reject(d1.id, 'BUKAN_KTM')
    expect(await c.studentVerification.status()).toMatchObject({ state: 'REJECTED', attemptsLeft: 2, reason: KTM_REJECT_REASONS.BUKAN_KTM, submittedAt: null })
    process.env.KTM_AUTO_REVIEW_SECONDS = '60'
    expect((await c.studentVerification.status()).slaText).toBe('Biasanya selesai dalam ±20 menit')
  })

  it('parses KTM_AUTO_REVIEW_SECONDS: unset = off, positive integers only', () => {
    expect(ktmAutoReviewSeconds({})).toBeNull()
    expect(ktmAutoReviewSeconds({ KTM_AUTO_REVIEW_SECONDS: '30' })).toBe(30)
    expect(() => ktmAutoReviewSeconds({ KTM_AUTO_REVIEW_SECONDS: '-1' })).toThrow()
  })
})

describe('reject codes and emails', () => {
  it('stores the Indonesian copy for a code (+ note), keeps free text, and rejects an empty reason', async () => {
    const s = await newStudent()
    const a = await doc(s.id, 'a')
    await rejectDocument(prisma, a.id, { reviewer: 'op', reason: 'FOTO_BURAM', note: 'sudut kiri' }, NOW)
    expect((await prisma.studentDocument.findUniqueOrThrow({ where: { id: a.id } })).reason).toBe(`${KTM_REJECT_REASONS.FOTO_BURAM} Catatan: sudut kiri`)
    expect(KTM_REJECT_REASONS.FOTO_BURAM).toBe('Foto kurang jelas. Ambil ulang tanpa blur atau pantulan cahaya.')
    const b = await doc(s.id, 'b')
    await rejectDocument(prisma, b.id, { reviewer: 'op', reason: 'Alasan bebas' }, NOW)
    expect((await prisma.studentDocument.findUniqueOrThrow({ where: { id: b.id } })).reason).toBe('Alasan bebas')
    await expect(rejectDocument(prisma, (await doc(s.id, 'c')).id, { reviewer: 'op', reason: ' ' }, NOW)).rejects.toThrow()
  })

  it('reject enqueues a mail with the reason, "Percobaan n dari 3" and /profile, and no card details', async () => {
    const s = await newStudent()
    await reject((await doc(s.id, 'a')).id, 'KTM_KEDALUWARSA')
    await reject((await doc(s.id, 'b')).id, 'FOTO_BURAM')
    const rows = await mails(s.email)
    const last = rows.filter((r) => r.template === 'student-rejected').at(-1)!
    const r = renderEmail(last.template, last.payload)!
    expect(r.text).toContain(KTM_REJECT_REASONS.FOTO_BURAM)
    expect(r.text).toContain('Percobaan 2 dari 3')
    expect(r.text).toContain('/profile')
    expect(r.text + r.html).not.toContain('2501234567')
    await reject((await doc(s.id, 'c')).id)
    const third = (await mails(s.email)).filter((x) => x.template === 'student-rejected').at(-1)!
    expect(renderEmail(third.template, third.payload)!.text).toMatch(/Percobaan 3 dari 3[\s\S]*Cara lain/)
  })
})

describe('auto-review', () => {
  it('approves only after the delay, sets verifiedCampusId and the claimed expiry, and enqueues the approve mail', async () => {
    const s = await newStudent()
    const c = await campus()
    const claimed = addDays(todayWIB(NOW), 100)
    await doc(s.id, 'a', { createdAt: new Date(NOW.getTime() - 50_000), claimedValidUntil: new Date(`${claimed}T00:00:00.000Z`) })
    expect(await autoReviewKtm(prisma, 60, NOW)).toBe(0)
    expect((await callerFor(s.id).studentVerification.status()).state).toBe('PENDING')
    expect(await autoReviewKtm(prisma, 60, new Date(NOW.getTime() + 11_000))).toBe(1)
    const u = await prisma.user.findUniqueOrThrow({ where: { id: s.id } })
    expect(u).toMatchObject({ campusVerifiedVia: 'KTM', verifiedCampusId: c.id })
    expect(u.campusVerifiedUntil!.toISOString()).toBe(new Date(`${claimed}T23:59:59.999+07:00`).toISOString())
    const m = (await mails(s.email)).find((r) => r.template === 'student-approved')!
    const r = renderEmail(m.template, m.payload)!
    expect(r.subject).toContain('Status mahasiswa terverifikasi')
    expect(r.text).toContain('/search')
  })

  it('falls back to +12 months when no (or a past) date was claimed, and caps a far-future claim', async () => {
    const [a, b, c] = [await newStudent(), await newStudent(), await newStudent()]
    await doc(a.id, 'a', { createdAt: new Date(NOW.getTime() - 99_000) })
    await doc(b.id, 'b', { createdAt: new Date(NOW.getTime() - 99_000), claimedValidUntil: new Date('2026-01-01T00:00:00Z') })
    await doc(c.id, 'c', { createdAt: new Date(NOW.getTime() - 99_000), claimedValidUntil: new Date('2031-01-01T00:00:00Z') })
    expect(await autoReviewKtm(prisma, 60, NOW)).toBe(3)
    const max = new Date(`${addDays(todayWIB(NOW), 364)}T23:59:59.999+07:00`).toISOString()
    for (const u of [a, b, c]) expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).campusVerifiedUntil!.toISOString()).toBe(max)
  })
})

describe('students:review CLI', () => {
  const run = (args: string[]) => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/review-students.ts', ...args], { cwd: BACKEND, env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, REVIEWER: 'tester' }, encoding: 'utf8', timeout: 60_000 })
    return { status: r.status, out: `${r.stdout}${r.stderr}` }
  }
  it('rejects with a code and a note, then resets the user', async () => {
    const s = await newStudent()
    const d = await doc(s.id, 'a')
    expect(run(['reject', d.id, 'NAMA_TIDAK_SESUAI', 'NIM salah']).status).toBe(0)
    expect(await prisma.studentDocument.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ reason: `${KTM_REJECT_REASONS.NAMA_TIDAK_SESUAI} Catatan: NIM salah`, reviewer: 'tester' })
    expect(run(['reset', s.id]).out).toContain('Reset 1')
    expect((await callerFor(s.id).studentVerification.status()).attemptsLeft).toBe(3)
  })
})
