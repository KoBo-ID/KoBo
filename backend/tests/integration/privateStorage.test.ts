import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeStorage, DEV_PRIVATE_PREFIX, DEV_UPLOAD_PREFIX } from '../../src/storage.ts'
import { app, storage } from '../helpers.ts'

afterEach(() => vi.useRealTimers())

// JPEG signature bytes: the private store does not check them, but KTM photos are JPEG/WebP in practice.
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5])
const newKey = () => `private/ktm/${randomUUID()}.jpg`

/** presign a private PUT, then "upload" the bytes through the app's dev route. */
async function uploadPrivate(key: string, bytes = BYTES, contentType = 'image/jpeg') {
  const p = await storage.presignPrivatePut(key, contentType, bytes.byteLength)
  return app.request(p.url, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes as never })
}

describe('private objects through the signed dev routes', () => {
  it('stores a private upload through its signed URL and serves it back through a signed GET', async () => {
    const key = newKey()
    expect((await uploadPrivate(key)).status).toBe(200)
    expect(storage.hasPrivate(key)).toBe(true)
    const got = await app.request(await storage.presignPrivateGet(key, 60))
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/jpeg')
    expect(got.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(BYTES)
  })

  it('rejects a private PUT with a wrong type, a wrong length, or no signature', async () => {
    const key = newKey()
    const p = await storage.presignPrivatePut(key, 'image/jpeg', BYTES.byteLength)
    const put = (url: string, body: Uint8Array, type: string) => app.request(url, { method: 'PUT', headers: { 'content-type': type }, body: body as never })
    expect((await put(p.url, BYTES, 'image/webp')).status).toBe(403)
    expect((await put(p.url, new Uint8Array(3), 'image/jpeg')).status).toBe(403)
    expect((await put(`${DEV_PRIVATE_PREFIX}${key}`, BYTES, 'image/jpeg')).status).toBe(403)
    expect(storage.hasPrivate(key)).toBe(false)
  })

  it('answers 403 to an unsigned GET, a tampered signature, and a tampered expiry', async () => {
    const key = newKey()
    storage.putPrivate(key, BYTES, 'image/jpeg')
    expect((await app.request(`${DEV_PRIVATE_PREFIX}${key}`)).status).toBe(403)
    const url = await storage.presignPrivateGet(key, 60)
    const badSig = url.replace(/sig=(.)/, (_, c: string) => `sig=${c === '0' ? '1' : '0'}`)
    expect(badSig).not.toBe(url)
    expect((await app.request(badSig)).status).toBe(403)
    const badExp = url.replace(/exp=(\d+)/, (_, e: string) => `exp=${Number(e) + 1000}`)
    expect((await app.request(badExp)).status).toBe(403)
    expect((await app.request(url)).status).toBe(200)
  })

  it('answers 403 to an expired signed GET and serves it again only before expiry', async () => {
    const key = newKey()
    storage.putPrivate(key, BYTES, 'image/jpeg')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-18T00:00:00Z'))
    const url = await storage.presignPrivateGet(key, 60)
    vi.setSystemTime(new Date('2026-11-18T00:00:30Z'))
    expect((await app.request(url)).status).toBe(200)
    vi.setSystemTime(new Date('2026-11-18T00:01:01Z'))
    expect((await app.request(url)).status).toBe(403)
  })

  it('the public dev GET never serves a private key, plain or encoded', async () => {
    const key = newKey()
    storage.putPrivate(key, BYTES, 'image/jpeg')
    expect((await app.request(`${DEV_UPLOAD_PREFIX}${key}`)).status).toBe(404)
    expect((await app.request(`${DEV_UPLOAD_PREFIX}${encodeURIComponent(key)}`)).status).toBe(404)
    expect(storage.has(key)).toBe(false)
    expect(storage.get(key)).toBeUndefined()
  })
})

describe('private storage (fake)', () => {
  it('presignPrivateGet accepts 60..300 seconds and rejects 30 and 400', async () => {
    const key = newKey()
    await expect(storage.presignPrivateGet(key, 60)).resolves.toContain(key)
    await expect(storage.presignPrivateGet(key, 300)).resolves.toContain(key)
    await expect(storage.presignPrivateGet(key, 30)).rejects.toThrow()
    await expect(storage.presignPrivateGet(key, 400)).rejects.toThrow()
  })

  it('private methods reject keys outside private/ and keys containing ..', async () => {
    const bad = ['kos/abc.webp', 'privatex/x.jpg', 'private/../kos/x.webp']
    for (const key of bad) {
      await expect(storage.presignPrivatePut(key, 'image/jpeg', 8)).rejects.toThrow('[storage] private key must start with private/')
      await expect(storage.presignPrivateGet(key, 60)).rejects.toThrow('[storage] private key must start with private/')
      await expect(storage.headPrivate(key)).rejects.toThrow('[storage] private key must start with private/')
      await expect(storage.peekPrivate(key, 4)).rejects.toThrow('[storage] private key must start with private/')
      await expect(storage.deletePrivate(key)).rejects.toThrow('[storage] private key must start with private/')
      expect(() => storage.putPrivate(key, BYTES, 'image/jpeg')).toThrow('[storage] private key must start with private/')
    }
  })

  it('publicUrl and the public presigned PUT refuse private keys', async () => {
    expect(() => storage.publicUrl('private/x.jpg')).toThrow()
    await expect(storage.presignPut('private/x.jpg', 'image/jpeg', 8)).rejects.toThrow()
  })

  it('deletePrivate removes the object', async () => {
    const key = newKey()
    storage.putPrivate(key, BYTES, 'image/jpeg')
    expect(await storage.headPrivate(key)).toEqual({ contentType: 'image/jpeg', contentLength: BYTES.byteLength })
    expect(await storage.peekPrivate(key, 2)).toEqual(BYTES.slice(0, 2))
    await storage.deletePrivate(key)
    expect(storage.hasPrivate(key)).toBe(false)
    expect(await storage.headPrivate(key)).toBeNull()
  })

  it('the public get, has, head and peek never see a private object', async () => {
    const s = createFakeStorage()
    const key = newKey()
    s.putPrivate(key, BYTES, 'image/jpeg')
    expect(s.has(key)).toBe(false)
    expect(s.get(key)).toBeUndefined()
    expect(await s.head(key)).toBeNull()
    expect(await s.peek(key, 2)).toBeNull()
  })
})
