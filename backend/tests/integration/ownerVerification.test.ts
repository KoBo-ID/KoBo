import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { ownerAutoReviewSeconds } from '../../src/env.ts'
import { purgeOwnerDocuments, deleteUserOwnerDocuments } from '../../src/ownerDocRetention.ts'
import { autoReviewOwners } from '../../src/ownerVerification/autoReview.ts'
import { approveOwner, rejectOwner, resetOwner, ReviewError, showOwner } from '../../src/ownerVerification/review.ts'
import { callerFor, newStudent, prisma, storage } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const code = async (p: Promise<unknown>) => (await err(p))?.code

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
const PDF = new TextEncoder().encode('%PDF-1.7\n%....')
const HTML = new TextEncoder().encode('<html><script>alert(1)</script>')
type Kind = 'KTP' | 'SHM' | 'SHGB' | 'AJB' | 'GIRIK' | 'SPPT_PBB' | 'SURAT_KUASA' | 'SURAT_KETERANGAN'

async function newOwner(ownershipType: string | null = 'PEMILIK') {
  const s = await newStudent()
  await prisma.ownerProfile.create({ data: { userId: s.id, ownershipType } })
  return s.id
}

/** presign + fake upload, returning the key. */
async function upload(userId: string, bytes: Uint8Array = JPEG, contentType: 'image/jpeg' | 'image/webp' | 'application/pdf' = 'image/jpeg') {
  const p = await callerFor(userId).ownerVerification.presign({ kind: 'KTP', contentType, contentLength: bytes.byteLength })
  storage.putPrivate(p.key, bytes, contentType)
  return p.key
}
async function submitKinds(userId: string, kinds: Kind[]) {
  const documents = await Promise.all(kinds.map(async (kind) => ({ kind, key: await upload(userId, kind === 'KTP' ? JPEG : PDF, kind === 'KTP' ? 'image/jpeg' : 'application/pdf') })))
  return callerFor(userId).ownerVerification.submit({ documents, consent: true })
}
const profile = (userId: string) => prisma.ownerProfile.findUniqueOrThrow({ where: { userId } })

describe('ownerVerification.presign', () => {
  it('issues a key under private/owner-docs/<userId>/ and enforces type and size', async () => {
    const o = await newOwner()
    const c = callerFor(o)
    const p = await c.ownerVerification.presign({ kind: 'KTP', contentType: 'application/pdf', contentLength: 1000 })
    expect(p.key).toMatch(new RegExp(`^private/owner-docs/${o}/[0-9a-f-]{36}$`))
    expect(p.headers['Content-Type']).toBe('application/pdf')
    expect(await code(c.ownerVerification.presign({ kind: 'KTP', contentType: 'image/jpeg', contentLength: 10_000_001 }))).toBe('BAD_REQUEST')
    expect(await code(c.ownerVerification.presign({ kind: 'KTP', contentType: 'image/gif' as never, contentLength: 10 }))).toBe('BAD_REQUEST')
  })

  it('refuses a non-owner with an Indonesian message', async () => {
    const s = await newStudent()
    const e = await err(callerFor(s.id).ownerVerification.presign({ kind: 'KTP', contentType: 'image/jpeg', contentLength: 10 }))
    expect([e?.code, e?.message]).toEqual(['FORBIDDEN', 'Fitur ini khusus pemilik kos.'])
    expect(await code(callerFor(s.id).ownerVerification.status())).toBe('FORBIDDEN')
  })
})

describe('ownerVerification.submit', () => {
  it('files the documents, moves to MENUNGGU and counts the attempt', async () => {
    const o = await newOwner()
    const state = await submitKinds(o, ['KTP', 'SHM'])
    expect(state).toMatchObject({ status: 'MENUNGGU', attemptsLeft: 2, reason: null })
    expect(state.documents.map((d) => [d.kind, d.status]).sort()).toEqual([['KTP', 'PENDING'], ['SHM', 'PENDING']])
    expect(await prisma.ownerDocument.count({ where: { userId: o } })).toBe(2)
    // Nothing in the response carries a storage key.
    expect(JSON.stringify(state)).not.toContain('private/')
    expect(JSON.stringify(await callerFor(o).ownerVerification.status())).not.toContain('private/')
  })

  it('refuses another user\'s key and a key outside the prefix, without touching the object', async () => {
    const a = await newOwner()
    const b = await newOwner()
    const foreign = await upload(b)
    const mine = await upload(a)
    expect(await code(callerFor(a).ownerVerification.submit({ documents: [{ kind: 'KTP', key: foreign }, { kind: 'SHM', key: mine }], consent: true }))).toBe('FORBIDDEN')
    expect(storage.hasPrivate(foreign)).toBe(true)
    expect(await code(callerFor(a).ownerVerification.submit({ documents: [{ kind: 'KTP', key: 'private/ktm/x/y' }, { kind: 'SHM', key: mine }], consent: true }))).toBe('FORBIDDEN')
    expect(await code(callerFor(a).ownerVerification.submit({ documents: [{ kind: 'KTP', key: `private/owner-docs/${a}/../${b}/z` }, { kind: 'SHM', key: mine }], consent: true }))).toBe('FORBIDDEN')
  })

  it('refuses a bad signature and deletes the object', async () => {
    const o = await newOwner()
    const bad = await upload(o, HTML, 'image/jpeg')
    const ok = await upload(o, PDF, 'application/pdf')
    expect(await code(callerFor(o).ownerVerification.submit({ documents: [{ kind: 'KTP', key: bad }, { kind: 'SHM', key: ok }], consent: true }))).toBe('BAD_REQUEST')
    expect(storage.hasPrivate(bad)).toBe(false)
    const fakePdf = await upload(o, JPEG, 'application/pdf')
    expect(await code(callerFor(o).ownerVerification.submit({ documents: [{ kind: 'KTP', key: fakePdf }, { kind: 'SHM', key: ok }], consent: true }))).toBe('BAD_REQUEST')
    expect((await profile(o)).verificationStatus).toBe('BELUM_KIRIM')
  })

  it('refuses a missing upload', async () => {
    const o = await newOwner()
    const key = await upload(o)
    expect(await code(callerFor(o).ownerVerification.submit({ documents: [{ kind: 'KTP', key }, { kind: 'SHM', key: `private/owner-docs/${o}/never` }], consent: true }))).toBe('BAD_REQUEST')
  })

  it.each([
    ['PEMILIK', ['KTP'], false],
    ['PEMILIK', ['KTP', 'SURAT_KUASA'], false],
    ['PEMILIK', ['KTP', 'SPPT_PBB'], true],
    ['PENGELOLA_KUASA', ['KTP', 'SHM'], false],
    ['PENGELOLA_KUASA', ['KTP', 'SURAT_KUASA'], false],
    ['PENGELOLA_KUASA', ['KTP', 'GIRIK', 'SURAT_KUASA'], true],
    ['LAINNYA', ['KTP', 'SHM'], false],
    ['LAINNYA', ['KTP', 'SURAT_KETERANGAN'], true],
  ] as [string, Kind[], boolean][])('Q6: %s with %j -> %s', async (role, kinds, ok) => {
    const o = await newOwner(role)
    const documents = await Promise.all(kinds.map(async (kind) => ({ kind, key: await upload(o) })))
    const res = await err(callerFor(o).ownerVerification.submit({ documents, consent: true }))
    if (ok) expect(res).toBeNull()
    else expect(res?.code).toBe('BAD_REQUEST')
  })

  it('refuses while MENUNGGU and after DISETUJUI', async () => {
    const o = await newOwner()
    await submitKinds(o, ['KTP', 'SHM'])
    expect(await code(submitKinds(o, ['KTP', 'SHM']))).toBe('CONFLICT')
    expect(await code(callerFor(o).ownerVerification.presign({ kind: 'KTP', contentType: 'image/jpeg', contentLength: 5 }))).toBe('CONFLICT')
    await approveOwner(prisma, o, { reviewer: 't' })
    expect(await code(submitKinds(o, ['KTP', 'SHM']))).toBe('PRECONDITION_FAILED')
  })

  it('refuses the 4th attempt, and reset gives attempts back', async () => {
    const o = await newOwner()
    for (let i = 0; i < 3; i++) {
      await submitKinds(o, ['KTP', 'SHM'])
      await rejectOwner(prisma, o, { reviewer: 't', code: 'DOKUMEN_TIDAK_SESUAI' })
    }
    const st = await callerFor(o).ownerVerification.status()
    expect([st.status, st.attemptsLeft]).toEqual(['DITOLAK', 0])
    const e = await err(submitKinds(o, ['KTP', 'SHM']))
    expect(e?.code).toBe('FORBIDDEN')
    expect((await profile(o)).verificationAttempts).toBe(3)
    await resetOwner(prisma, o)
    expect((await callerFor(o).ownerVerification.status()).attemptsLeft).toBe(3)
    expect((await submitKinds(o, ['KTP', 'SHM'])).status).toBe('MENUNGGU')
  })

  it('a resubmit after DITOLAK sends only the replacement; the approved document is kept', async () => {
    const o = await newOwner()
    await submitKinds(o, ['KTP', 'SHM'])
    await rejectOwner(prisma, o, { reviewer: 't', code: 'KTP_BURAM' })
    const rejected = await callerFor(o).ownerVerification.status()
    expect(rejected.status).toBe('DITOLAK')
    expect(rejected.reason).toContain('KTP')
    expect(rejected.documents.map((d) => [d.kind, d.status]).sort()).toEqual([['KTP', 'REJECTED'], ['SHM', 'APPROVED']])
    // Re-sending the kept kind is refused; sending nothing new for KTP is refused (Q6 not met).
    expect(await code(submitKinds(o, ['SHM']))).toBe('BAD_REQUEST')
    expect(await code(submitKinds(o, ['SURAT_KUASA']))).toBe('BAD_REQUEST')
    const after = await submitKinds(o, ['KTP'])
    expect(after.status).toBe('MENUNGGU')
    expect(after.attemptsLeft).toBe(1)
    expect(after.documents.map((d) => [d.kind, d.status]).sort()).toEqual([['KTP', 'PENDING'], ['SHM', 'APPROVED']])
    await approveOwner(prisma, o, { reviewer: 't' })
    expect((await callerFor(o).ownerVerification.status()).documents.every((d) => d.status === 'APPROVED')).toBe(true)
  })
})

describe('review: approve, reject, reset', () => {
  it('approve sets DISETUJUI, approvedAt once, deleteAfter = decision + 90 d, and queues one Indonesian email', async () => {
    const o = await newOwner()
    await submitKinds(o, ['KTP', 'SHM'])
    const now = new Date('2026-12-01T03:00:00.000Z')
    await approveOwner(prisma, o, { reviewer: 'tester' }, now)
    const p = await profile(o)
    expect([p.verificationStatus, p.approvedAt?.toISOString()]).toEqual(['DISETUJUI', now.toISOString()])
    const docs = await prisma.ownerDocument.findMany({ where: { userId: o } })
    expect(docs.every((d) => d.status === 'APPROVED' && d.reviewer === 'tester' && d.deleteAfter?.toISOString() === '2027-03-01T03:00:00.000Z')).toBe(true)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: o } })
    const mails = await prisma.emailOutbox.findMany({ where: { to: user.email, template: 'owner-approved' } })
    expect(mails).toHaveLength(1)
    expect(JSON.stringify(mails[0]!.payload)).not.toMatch(/KTP|SHM|private/)
    // A second decision loses the race guard.
    await expect(approveOwner(prisma, o, { reviewer: 'x' })).rejects.toBeInstanceOf(ReviewError)
    await expect(rejectOwner(prisma, o, { reviewer: 'x', code: 'KTP_BURAM' })).rejects.toBeInstanceOf(ReviewError)
  })

  it('approve keeps an existing approvedAt', async () => {
    const o = await newOwner()
    const earlier = new Date('2026-01-01T00:00:00.000Z')
    await prisma.ownerProfile.update({ where: { userId: o }, data: { approvedAt: earlier } })
    await submitKinds(o, ['KTP', 'SHM'])
    await approveOwner(prisma, o, { reviewer: 't' })
    expect((await profile(o)).approvedAt?.toISOString()).toBe(earlier.toISOString())
  })

  it('reject sets DITOLAK with the code copy and marks the named documents', async () => {
    const o = await newOwner('PENGELOLA_KUASA')
    await submitKinds(o, ['KTP', 'SHM', 'SURAT_KUASA'])
    await rejectOwner(prisma, o, { reviewer: 't', code: 'KUASA_TIDAK_ADA', note: 'tanda tangan kosong' })
    const p = await profile(o)
    expect(p.verificationStatus).toBe('DITOLAK')
    expect(p.verificationReason).toContain('Surat kuasa')
    expect(p.verificationReason).toContain('tanda tangan kosong')
    const docs = await prisma.ownerDocument.findMany({ where: { userId: o } })
    expect(docs.map((d) => [d.kind, d.status]).sort()).toEqual([['KTP', 'APPROVED'], ['SHM', 'APPROVED'], ['SURAT_KUASA', 'REJECTED']])
    expect(docs.every((d) => d.deleteAfter !== null)).toBe(true)
    expect(await prisma.emailOutbox.count({ where: { template: 'owner-rejected' } })).toBe(1)
    await expect(rejectOwner(prisma, o, { reviewer: 't', code: 'NOPE' as never })).rejects.toBeInstanceOf(ReviewError)
  })

  it('reject with explicit kinds, and without a hint rejects everything', async () => {
    const a = await newOwner()
    await submitKinds(a, ['KTP', 'SHM'])
    await rejectOwner(prisma, a, { reviewer: 't', code: 'NAMA_TIDAK_SAMA', kinds: ['SHM'] })
    expect((await prisma.ownerDocument.findMany({ where: { userId: a } })).map((d) => [d.kind, d.status]).sort()).toEqual([['KTP', 'APPROVED'], ['SHM', 'REJECTED']])
    const b = await newOwner()
    await submitKinds(b, ['KTP', 'SHM'])
    await rejectOwner(prisma, b, { reviewer: 't', code: 'DOKUMEN_TIDAK_SESUAI' })
    expect((await prisma.ownerDocument.findMany({ where: { userId: b } })).every((d) => d.status === 'REJECTED')).toBe(true)
  })

  it('show returns a 120 s link per document, and only for an existing owner', async () => {
    const o = await newOwner()
    await submitKinds(o, ['KTP', 'SHM'])
    const shown = await showOwner(prisma, storage, o)
    expect(shown.documents).toHaveLength(2)
    for (const d of shown.documents) expect(d.url).toContain('/api/dev-private/private/owner-docs/')
    await expect(showOwner(prisma, storage, 'nobody')).rejects.toBeInstanceOf(ReviewError)
  })
})

describe('retention and auto-review', () => {
  it('purges due files, sets deletedAt, and leaves others alone', async () => {
    const o = await newOwner()
    await submitKinds(o, ['KTP', 'SHM'])
    const decided = new Date('2026-12-01T00:00:00.000Z')
    await approveOwner(prisma, o, { reviewer: 't' }, decided)
    const docs = await prisma.ownerDocument.findMany({ where: { userId: o } })
    expect(await purgeOwnerDocuments(prisma, storage, new Date('2027-02-28T00:00:00.000Z'))).toBe(0)
    expect(docs.every((d) => storage.hasPrivate(d.key))).toBe(true)
    expect(await purgeOwnerDocuments(prisma, storage, new Date('2027-03-02T00:00:00.000Z'))).toBe(2)
    expect(docs.some((d) => storage.hasPrivate(d.key))).toBe(false)
    expect((await prisma.ownerDocument.findMany({ where: { userId: o } })).every((d) => d.deletedAt !== null)).toBe(true)
    expect((await callerFor(o).ownerVerification.status()).documents).toEqual([])
  })

  it('deleteUserOwnerDocuments removes every object of the user', async () => {
    const o = await newOwner()
    await submitKinds(o, ['KTP', 'SHM'])
    const keys = (await prisma.ownerDocument.findMany({ where: { userId: o } })).map((d) => d.key)
    expect(await deleteUserOwnerDocuments(prisma, storage, o)).toBe(2)
    expect(keys.some((k) => storage.hasPrivate(k))).toBe(false)
  })

  it('auto-review approves only owners whose submit is old enough', async () => {
    const o = await newOwner()
    await submitKinds(o, ['KTP', 'SHM'])
    const t0 = Date.now()
    // The seed's sample MENUNGGU owner may also be approved by these calls, so assert on this owner, not on counts.
    await autoReviewOwners(prisma, 60, new Date(t0 + 30_000))
    expect((await profile(o)).verificationStatus).toBe('MENUNGGU')
    expect(await autoReviewOwners(prisma, 60, new Date(t0 + 61_000))).toBeGreaterThanOrEqual(1)
    const p = await profile(o)
    expect([p.verificationStatus, p.approvedAt !== null]).toEqual(['DISETUJUI', true])
    expect((await prisma.ownerDocument.findFirstOrThrow({ where: { userId: o } })).reviewer).toBe('auto-review')
    expect(await autoReviewOwners(prisma, 60, new Date(t0 + 120_000))).toBe(0)
  })

  it('parses OWNER_AUTO_REVIEW_SECONDS: unset = off, positive integers only', () => {
    expect(ownerAutoReviewSeconds({})).toBeNull()
    expect(ownerAutoReviewSeconds({ OWNER_AUTO_REVIEW_SECONDS: '' })).toBeNull()
    expect(ownerAutoReviewSeconds({ OWNER_AUTO_REVIEW_SECONDS: '45' })).toBe(45)
    expect(() => ownerAutoReviewSeconds({ OWNER_AUTO_REVIEW_SECONDS: '0' })).toThrow()
    expect(() => ownerAutoReviewSeconds({ OWNER_AUTO_REVIEW_SECONDS: 'abc' })).toThrow()
  })
})
