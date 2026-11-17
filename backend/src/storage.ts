import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface PresignedPut {
  url: string
  /** Headers the browser MUST send with the PUT (they are part of the signature). */
  headers: Record<string, string>
}

export interface HeadResult {
  contentType: string
  contentLength: number
}

/** The storage port (spec section 9). Real implementation: Cloudflare R2. Tests and dev/e2e: the in-memory fake. */
export interface Storage {
  kind: 'r2' | 'fake'
  presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedPut>
  head(key: string): Promise<HeadResult | null>
  /** The first `length` bytes of an object (null when it does not exist). Used to check the file signature, not just the declared type. */
  peek(key: string, length: number): Promise<Uint8Array | null>
  delete(key: string): Promise<void>
  publicUrl(key: string): string
}

/**
 * True when the leading bytes match the declared image type (WebP: RIFF....WEBP, JPEG: FF D8 FF). A signature check, not
 * a decode: it stops HTML, SVG, scripts and executables declared as images, while re-encoding stays a separate hardening step.
 */
export function hasImageSignature(contentType: string, bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (contentType === 'image/webp') return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  return false
}

/** Presigned PUTs live this long; an upload is a few hundred KB so a minute is plenty. */
export const PRESIGN_EXPIRES_SECONDS = 120

// ---------------------------------------------------------------------------
// R2 (S3-compatible)
// ---------------------------------------------------------------------------

export interface R2Config {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  publicBaseUrl: string
}

export function createR2Storage(cfg: R2Config): Storage {
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  const base = cfg.publicBaseUrl.replace(/\/+$/, '')
  return {
    kind: 'r2',
    async presignPut(key, contentType, contentLength) {
      const command = new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType, ContentLength: contentLength })
      const url = await getSignedUrl(client, command, {
        expiresIn: PRESIGN_EXPIRES_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      })
      return { url, headers: { 'Content-Type': contentType } }
    },
    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))
        return { contentType: res.ContentType ?? '', contentLength: res.ContentLength ?? 0 }
      } catch (e) {
        const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null
        throw e
      }
    },
    async peek(key, length) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key, Range: `bytes=0-${length - 1}` }))
        return res.Body ? await res.Body.transformToByteArray() : null
      } catch (e) {
        const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
        if (err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null
        throw e
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
    },
    publicUrl: (key) => `${base}/${key}`,
  }
}

// ---------------------------------------------------------------------------
// In-memory fake
// ---------------------------------------------------------------------------

/** Path prefix of the dev-only upload route (mounted only while the fake is active). */
export const DEV_UPLOAD_PREFIX = '/api/dev-uploads/'

export interface FakeStorage extends Storage {
  kind: 'fake'
  /** What a browser PUT to the presigned URL would store. */
  put(key: string, bytes: Uint8Array, contentType: string): void
  get(key: string): { bytes: Uint8Array; contentType: string } | undefined
  has(key: string): boolean
  /** Checks the HMAC the fake presign put in the URL (key, type, length, expiry). */
  verifyUpload(key: string, q: { ct?: string; len?: string; exp?: string; sig?: string }): boolean
}

export function createFakeStorage(): FakeStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  // Per-instance secret: the fake's URLs are signed like a real presign, so an unsigned PUT can never write an object.
  const secret = randomBytes(32)
  const sign = (key: string, ct: string, len: string, exp: string) => createHmac('sha256', secret).update(`${key}\n${ct}\n${len}\n${exp}`).digest('hex')
  return {
    kind: 'fake',
    async presignPut(key, contentType, contentLength) {
      const exp = Date.now() + PRESIGN_EXPIRES_SECONDS * 1000
      const q = new URLSearchParams({ ct: contentType, len: String(contentLength), exp: String(exp), sig: sign(key, contentType, String(contentLength), String(exp)) })
      return { url: `${DEV_UPLOAD_PREFIX}${key}?${q}`, headers: { 'Content-Type': contentType } }
    },
    async head(key) {
      const o = objects.get(key)
      return o ? { contentType: o.contentType, contentLength: o.bytes.byteLength } : null
    },
    async peek(key, length) {
      const o = objects.get(key)
      return o ? o.bytes.slice(0, length) : null
    },
    async delete(key) {
      objects.delete(key)
    },
    verifyUpload(key, q) {
      if (!q.ct || !q.len || !q.exp || !q.sig) return false
      const expected = Buffer.from(sign(key, q.ct, q.len, q.exp), 'hex')
      const given = Buffer.from(q.sig, 'hex')
      return given.length === expected.length && timingSafeEqual(given, expected)
    },
    publicUrl: (key) => `${DEV_UPLOAD_PREFIX}${key}`,
    put: (key, bytes, contentType) => void objects.set(key, { bytes, contentType }),
    get: (key) => objects.get(key),
    has: (key) => objects.has(key),
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** R2 when every R2_* variable is set; otherwise the in-memory fake (dev/e2e) and a log line saying so. */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): Storage {
  const { R2_ENDPOINT, R2_PUBLIC_BUCKET, R2_PUBLIC_ACCESS_KEY_ID, R2_PUBLIC_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL } = env
  if (R2_ENDPOINT && R2_PUBLIC_BUCKET && R2_PUBLIC_ACCESS_KEY_ID && R2_PUBLIC_SECRET_ACCESS_KEY && R2_PUBLIC_BASE_URL) {
    return createR2Storage({
      endpoint: R2_ENDPOINT,
      bucket: R2_PUBLIC_BUCKET,
      accessKeyId: R2_PUBLIC_ACCESS_KEY_ID,
      secretAccessKey: R2_PUBLIC_SECRET_ACCESS_KEY,
      publicBaseUrl: R2_PUBLIC_BASE_URL,
    })
  }
  // The fake mounts an unauthenticated dev upload route, so production must never fall back to it
  // silently. The e2e server runs with NODE_ENV=production and opts in explicitly.
  if (env.NODE_ENV === 'production' && env.ALLOW_FAKE_STORAGE !== '1') {
    throw new Error('[storage] R2_* is not fully set in production. Set every R2_PUBLIC_* variable (or ALLOW_FAKE_STORAGE=1 for e2e only).')
  }
  console.log('[storage] R2_* not set: using the in-memory fake storage (uploads are lost on restart).')
  return createFakeStorage()
}
