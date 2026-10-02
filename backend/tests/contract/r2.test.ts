import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createR2Storage } from '../../src/storage.ts'

// Real-bucket contract test (spec section 9): runs only when the R2_TEST_* variables exist, i.e. on main/tags in CI.
// It uses a dedicated `kobo-test` bucket, never the production one.
const { R2_ENDPOINT, R2_TEST_BUCKET, R2_TEST_ACCESS_KEY_ID, R2_TEST_SECRET_ACCESS_KEY, R2_TEST_PUBLIC_BASE_URL } = process.env
const configured = !!(R2_ENDPOINT && R2_TEST_BUCKET && R2_TEST_ACCESS_KEY_ID && R2_TEST_SECRET_ACCESS_KEY)

describe.skipIf(!configured)('R2 storage (real bucket)', () => {
  it('presign, PUT, HEAD, delete', async () => {
    const storage = createR2Storage({
      endpoint: R2_ENDPOINT!,
      bucket: R2_TEST_BUCKET!,
      accessKeyId: R2_TEST_ACCESS_KEY_ID!,
      secretAccessKey: R2_TEST_SECRET_ACCESS_KEY!,
      publicBaseUrl: R2_TEST_PUBLIC_BASE_URL ?? 'https://example.invalid',
    })
    const key = `contract-test/${randomUUID()}-800.webp`
    const body = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])
    expect(await storage.head(key)).toBeNull()

    const signed = await storage.presignPut(key, 'image/webp', body.byteLength)
    // A mismatching Content-Type must be refused: it is part of the signature.
    const wrong = await fetch(signed.url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body })
    expect(wrong.ok).toBe(false)

    const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body })
    expect(put.status).toBe(200)
    try {
      expect(await storage.head(key)).toEqual({ contentType: 'image/webp', contentLength: body.byteLength })
    } finally {
      await storage.delete(key)
    }
    expect(await storage.head(key)).toBeNull()
  })
})
