import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { app, caller, callerFor, DEMO_STUDENT_ID, prisma, storage } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const code = async (p: Promise<unknown>) => (await err(p))?.code

async function ownerAndKos() {
  const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: {} } }, include: { kos: { orderBy: { createdAt: 'asc' } } }, orderBy: { id: 'asc' } })
  return { userId: owner.userId, kosId: owner.kos[0].id }
}
async function otherOwner(not: string) {
  return prisma.ownerProfile.findFirstOrThrow({ where: { userId: { not }, kos: { some: {} } }, include: { kos: true } })
}
const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

/** presign, then "upload" through the fake, returning the presign result. */
async function upload(userId: string, kosId: string, width = 800, bytes = BYTES, contentType = 'image/webp') {
  const p = await callerFor(userId).owner.image.presign({ kosId, contentType: contentType as 'image/webp', contentLength: bytes.byteLength, width })
  storage.put(p.key, bytes, contentType)
  return p
}

describe('owner.image.presign', () => {
  it('issues a key under kos/<kosId>/ ending in -<width>.webp, with a short-lived URL and signed headers', async () => {
    const { userId, kosId } = await ownerAndKos()
    const p = await callerFor(userId).owner.image.presign({ kosId, contentType: 'image/webp', contentLength: 1000, width: 1600 })
    expect(p.key).toMatch(new RegExp(`^kos/${kosId}/[0-9a-f-]+-1600\\.webp$`))
    expect(p.url).toContain(p.key)
    expect(p.headers['Content-Type']).toBe('image/webp')
    expect(p.expiresInSeconds).toBeLessThanOrEqual(300)
  })

  it('rejects oversize files, unsupported types and zero length', async () => {
    const { userId, kosId } = await ownerAndKos()
    const c = callerFor(userId)
    const base = { kosId, contentType: 'image/webp' as const, contentLength: 1000, width: 800 }
    expect(await code(c.owner.image.presign({ ...base, contentLength: 2 * 1024 * 1024 + 1 }))).toBe('BAD_REQUEST')
    expect(await code(c.owner.image.presign({ ...base, contentLength: 0 }))).toBe('BAD_REQUEST')
    expect(await code(c.owner.image.presign({ ...base, contentType: 'image/gif' as never }))).toBe('BAD_REQUEST')
    expect(await code(c.owner.image.presign({ ...base, contentType: 'application/pdf' as never }))).toBe('BAD_REQUEST')
    expect((await c.owner.image.presign({ ...base, contentType: 'image/jpeg' })).key).toBeTruthy()
  })

  it('rejects another owner and a student', async () => {
    const { userId, kosId } = await ownerAndKos()
    const other = await otherOwner(userId)
    const input = { kosId, contentType: 'image/webp' as const, contentLength: 1000, width: 800 }
    expect(await code(callerFor(other.userId).owner.image.presign(input))).toBe('FORBIDDEN')
    expect(await code(callerFor(DEMO_STUDENT_ID).owner.image.presign(input))).toBe('FORBIDDEN')
  })
})

describe('owner.image.confirm', () => {
  it('writes a KosImage after the HEAD check, and the photo shows up in kos.list as a public URL', async () => {
    const { userId, kosId } = await ownerAndKos()
    const before = await prisma.kosImage.count({ where: { kosId } })
    const p = await upload(userId, kosId)
    const res = await callerFor(userId).owner.image.confirm({ kosId, key: p.key, width: 800, height: 600, order: before })
    const row = await prisma.kosImage.findUniqueOrThrow({ where: { id: res.id } })
    expect(row).toMatchObject({ kosId, key: p.key, url: null, width: 800, height: 600, order: before })
    const card = (await caller.kos.list({ limit: 200 })).find((k) => k.id === kosId)!
    expect(card.images).toContain(storage.publicUrl(p.key))
  })

  it('rejects an object that was never uploaded, a size mismatch and a type mismatch', async () => {
    const { userId, kosId } = await ownerAndKos()
    const c = callerFor(userId)
    const count = await prisma.kosImage.count({ where: { kosId } })
    const missing = await c.owner.image.presign({ kosId, contentType: 'image/webp', contentLength: 8, width: 800 })
    expect(await code(c.owner.image.confirm({ kosId, key: missing.key, width: 800, height: 600, order: 0 }))).toBe('BAD_REQUEST')

    const sized = await c.owner.image.presign({ kosId, contentType: 'image/webp', contentLength: 8, width: 800 })
    storage.put(sized.key, new Uint8Array(3 * 1024 * 1024), 'image/webp') // bigger than anything presign allows
    expect(await code(c.owner.image.confirm({ kosId, key: sized.key, width: 800, height: 600, order: 0 }))).toBe('BAD_REQUEST')

    const typed = await c.owner.image.presign({ kosId, contentType: 'image/webp', contentLength: 8, width: 800 })
    storage.put(typed.key, BYTES, 'application/pdf')
    expect(await code(c.owner.image.confirm({ kosId, key: typed.key, width: 800, height: 600, order: 0 }))).toBe('BAD_REQUEST')
    expect(await prisma.kosImage.count({ where: { kosId } })).toBe(count)
  })

  it('rejects keys outside this kos prefix, and another owner confirming', async () => {
    const { userId, kosId } = await ownerAndKos()
    const other = await otherOwner(userId)
    const foreign = await upload(other.userId, other.kos[0].id)
    expect(await code(callerFor(userId).owner.image.confirm({ kosId, key: foreign.key, width: 800, height: 600, order: 0 }))).toBe('BAD_REQUEST')
    expect(await code(callerFor(userId).owner.image.confirm({ kosId, key: `kos/${kosId}/../x.webp`, width: 800, height: 600, order: 0 }))).toBe('BAD_REQUEST')
    expect(await code(callerFor(other.userId).owner.image.confirm({ kosId, key: foreign.key, width: 800, height: 600, order: 0 }))).toBe('FORBIDDEN')
  })

  it('is idempotent for the same key', async () => {
    const { userId, kosId } = await ownerAndKos()
    const p = await upload(userId, kosId)
    const c = callerFor(userId)
    const a = await c.owner.image.confirm({ kosId, key: p.key, width: 800, height: 600, order: 9 })
    const b = await c.owner.image.confirm({ kosId, key: p.key, width: 800, height: 600, order: 9 })
    expect(b.id).toBe(a.id)
    expect(await prisma.kosImage.count({ where: { key: p.key } })).toBe(1)
  })
})

describe('owner.image.delete and reorder', () => {
  it('deletes the row and the stored object; a cross-owner delete is rejected and changes nothing', async () => {
    const { userId, kosId } = await ownerAndKos()
    const p = await upload(userId, kosId)
    const { id } = await callerFor(userId).owner.image.confirm({ kosId, key: p.key, width: 800, height: 600, order: 5 })
    const other = await otherOwner(userId)
    expect(await code(callerFor(other.userId).owner.image.delete({ kosId: other.kos[0].id, imageId: id }))).toBe('NOT_FOUND')
    expect(await code(callerFor(other.userId).owner.image.delete({ kosId, imageId: id }))).toBe('FORBIDDEN')
    expect(storage.has(p.key)).toBe(true)
    await callerFor(userId).owner.image.delete({ kosId, imageId: id })
    expect(await prisma.kosImage.findUnique({ where: { id } })).toBeNull()
    expect(storage.has(p.key)).toBe(false)
  })

  it('removes the sibling 800 px variant that shares the photo uuid', async () => {
    const { userId, kosId } = await ownerAndKos()
    const c = callerFor(userId)
    const baseId = '3f2b8c1e-5d4a-4b7e-9a10-0123456789ab'
    const small = await c.owner.image.presign({ kosId, contentType: 'image/webp', contentLength: 8, width: 800, baseId })
    const large = await c.owner.image.presign({ kosId, contentType: 'image/webp', contentLength: 8, width: 1600, baseId })
    expect(small.key).toBe(`kos/${kosId}/${baseId}-800.webp`)
    storage.put(small.key, BYTES, 'image/webp')
    storage.put(large.key, BYTES, 'image/webp')
    const { id } = await c.owner.image.confirm({ kosId, key: large.key, width: 1600, height: 900, order: 7 })
    await c.owner.image.delete({ kosId, imageId: id })
    expect(storage.has(large.key)).toBe(false)
    expect(storage.has(small.key)).toBe(false)
  })

  it('deletes a seeded external-URL photo without touching storage', async () => {
    const { userId, kosId } = await ownerAndKos()
    const img = await prisma.kosImage.findFirstOrThrow({ where: { kosId, url: { not: null } } })
    await callerFor(userId).owner.image.delete({ kosId, imageId: img.id })
    expect(await prisma.kosImage.findUnique({ where: { id: img.id } })).toBeNull()
  })

  it('reorders by the given id list and rejects ids of another kos', async () => {
    const { userId, kosId } = await ownerAndKos()
    const c = callerFor(userId)
    const rows = await prisma.kosImage.findMany({ where: { kosId }, orderBy: { order: 'asc' } })
    expect(rows.length).toBeGreaterThan(1)
    const reversed = rows.map((r) => r.id).reverse()
    await c.owner.image.reorder({ kosId, imageIds: reversed })
    const after = await prisma.kosImage.findMany({ where: { kosId }, orderBy: { order: 'asc' } })
    expect(after.map((r) => r.id)).toEqual(reversed)
    const other = await otherOwner(userId)
    const foreign = await prisma.kosImage.findFirstOrThrow({ where: { kosId: other.kos[0].id } })
    expect(await code(c.owner.image.reorder({ kosId, imageIds: [...reversed, foreign.id] }))).toBe('BAD_REQUEST')
  })
})

describe('dev upload route (fake storage)', () => {
  it('accepts a PUT matching the presigned type and length, serves it back, rejects mismatches', async () => {
    const { userId, kosId } = await ownerAndKos()
    const p = await callerFor(userId).owner.image.presign({ kosId, contentType: 'image/webp', contentLength: BYTES.byteLength, width: 800 })
    const put = (body: Uint8Array, type: string) => Promise.resolve(app.request(p.url, { method: 'PUT', headers: { 'content-type': type }, body: body as never }))
    expect((await put(BYTES, 'image/jpeg')).status).toBe(403)
    expect((await put(new Uint8Array(3), 'image/webp')).status).toBe(403)
    expect((await put(BYTES, 'image/webp')).status).toBe(200)
    const got = await app.request(storage.publicUrl(p.key))
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/webp')
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(BYTES)
  })
})
