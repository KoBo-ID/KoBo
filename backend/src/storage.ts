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
  /**
   * Private bucket (KTM photos; keys under `private/`, never publicly readable). Real: R2_PRIVATE_* credentials sharing R2_ENDPOINT.
   * The fake keeps a separate map.
   */
  presignPrivatePut(key: string, contentType: string, contentLength: number): Promise<PresignedPut>
  /** A short-lived read URL (60..300 seconds). */
  presignPrivateGet(key: string, expiresSeconds: number): Promise<string>
  headPrivate(key: string): Promise<HeadResult | null>
  peekPrivate(key: string, length: number): Promise<Uint8Array | null>
  deletePrivate(key: string): Promise<void>
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

/** Key prefix of every private (KTM) object. Private keys are never reachable through a public URL. */
export const PRIVATE_PREFIX = 'private/'
/** Private read URLs live 60..300 seconds. */
export const PRIVATE_GET_MIN_SECONDS = 60
export const PRIVATE_GET_MAX_SECONDS = 300

const PRIVATE_NOT_CONFIGURED = '[storage] private bucket is not configured (R2_PRIVATE_*).'

function isPrivateKey(key: string): boolean {
  return key.startsWith(PRIVATE_PREFIX) && !key.includes('..')
}

/** Throws unless the key is a private key (under private/, no `..`). Every private method calls it first. */
export function assertPrivateKey(key: string): void {
  if (!isPrivateKey(key)) throw new Error('[storage] private key must start with private/')
}

/** Public URLs and public presigned PUTs must never name a private object. */
function assertPublicKey(key: string): void {
  if (key.startsWith(PRIVATE_PREFIX)) throw new Error('[storage] private/ objects have no public URL or public presigned PUT')
}

function assertPrivateGetExpiry(expiresSeconds: number): void {
  if (!(expiresSeconds >= PRIVATE_GET_MIN_SECONDS && expiresSeconds <= PRIVATE_GET_MAX_SECONDS)) {
    throw new Error(`[storage] private GET expiry must be ${PRIVATE_GET_MIN_SECONDS}..${PRIVATE_GET_MAX_SECONDS} seconds`)
  }
}

// ---------------------------------------------------------------------------
// R2 (S3-compatible)
// ---------------------------------------------------------------------------

export interface R2Config {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  publicBaseUrl: string
  /** The private bucket (KTM photos), same endpoint, its own credentials. Absent: every private method throws. */
  private?: { bucket: string; accessKeyId: string; secretAccessKey: string }
}

async function presignPutOn(client: S3Client, bucket: string, key: string, contentType: string, contentLength: number): Promise<PresignedPut> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength })
  const url = await getSignedUrl(client, command, {
    expiresIn: PRESIGN_EXPIRES_SECONDS,
    signableHeaders: new Set(['content-type', 'content-length']),
  })
  return { url, headers: { 'Content-Type': contentType } }
}

async function headObjectOn(client: S3Client, bucket: string, key: string): Promise<HeadResult | null> {
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { contentType: res.ContentType ?? '', contentLength: res.ContentLength ?? 0 }
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}

async function peekObjectOn(client: S3Client, bucket: string, key: string, length: number): Promise<Uint8Array | null> {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${length - 1}` }))
    return res.Body ? await res.Body.transformToByteArray() : null
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}

export function createR2Storage(cfg: R2Config): Storage {
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  const privateSide = cfg.private
    ? {
        client: new S3Client({
          region: 'auto',
          endpoint: cfg.endpoint,
          credentials: { accessKeyId: cfg.private.accessKeyId, secretAccessKey: cfg.private.secretAccessKey },
        }),
        bucket: cfg.private.bucket,
      }
    : null
  const privateOrThrow = () => {
    if (!privateSide) throw new Error(PRIVATE_NOT_CONFIGURED)
    return privateSide
  }
  const base = cfg.publicBaseUrl.replace(/\/+$/, '')
  return {
    kind: 'r2',
    async presignPut(key, contentType, contentLength) {
      assertPublicKey(key)
      return presignPutOn(client, cfg.bucket, key, contentType, contentLength)
    },
    async head(key) {
      return headObjectOn(client, cfg.bucket, key)
    },
    async peek(key, length) {
      return peekObjectOn(client, cfg.bucket, key, length)
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
    },
    publicUrl: (key) => {
      assertPublicKey(key)
      return `${base}/${key}`
    },
    async presignPrivatePut(key, contentType, contentLength) {
      assertPrivateKey(key)
      const p = privateOrThrow()
      return presignPutOn(p.client, p.bucket, key, contentType, contentLength)
    },
    async presignPrivateGet(key, expiresSeconds) {
      assertPrivateKey(key)
      assertPrivateGetExpiry(expiresSeconds)
      const p = privateOrThrow()
      const command = new GetObjectCommand({ Bucket: p.bucket, Key: key, ResponseCacheControl: 'no-store' })
      return getSignedUrl(p.client, command, { expiresIn: expiresSeconds })
    },
    async headPrivate(key) {
      assertPrivateKey(key)
      const p = privateOrThrow()
      return headObjectOn(p.client, p.bucket, key)
    },
    async peekPrivate(key, length) {
      assertPrivateKey(key)
      const p = privateOrThrow()
      return peekObjectOn(p.client, p.bucket, key, length)
    },
    async deletePrivate(key) {
      assertPrivateKey(key)
      const p = privateOrThrow()
      await p.client.send(new DeleteObjectCommand({ Bucket: p.bucket, Key: key }))
    },
  }
}

// ---------------------------------------------------------------------------
// In-memory fake
// ---------------------------------------------------------------------------

/** Path prefix of the dev-only upload route (mounted only while the fake is active). */
export const DEV_UPLOAD_PREFIX = '/api/dev-uploads/'
/** Path prefix of the dev-only private object route (mounted only while the fake is active). */
export const DEV_PRIVATE_PREFIX = '/api/dev-private/'

export interface FakeStorage extends Storage {
  kind: 'fake'
  /** What a browser PUT to the presigned URL would store. */
  put(key: string, bytes: Uint8Array, contentType: string): void
  get(key: string): { bytes: Uint8Array; contentType: string } | undefined
  has(key: string): boolean
  /** Checks the HMAC the fake presign put in the URL (key, type, length, expiry). */
  verifyUpload(key: string, q: { ct?: string; len?: string; exp?: string; sig?: string }): boolean
  /** What a browser PUT to a private presigned URL would store. */
  putPrivate(key: string, bytes: Uint8Array, contentType: string): void
  getPrivate(key: string): { bytes: Uint8Array; contentType: string } | undefined
  hasPrivate(key: string): boolean
  /** Checks the HMAC of a private presigned PUT (key, type, length, expiry) and that it has not expired. False for non-private keys. */
  verifyPrivateUpload(key: string, q: { ct?: string; len?: string; exp?: string; sig?: string }): boolean
  /** Checks the HMAC of a private presigned GET (key, expiry) and that it has not expired (timing-safe). False for non-private keys. */
  verifyPrivateGet(key: string, q: { exp?: string; sig?: string }): boolean
}

export function createFakeStorage(): FakeStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  // Private objects live in their own map: the public get/has/head/peek never see them.
  const privateObjects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  // Per-instance secret: the fake's URLs are signed like a real presign, so an unsigned PUT can never write an object.
  const secret = randomBytes(32)
  const sign = (key: string, ct: string, len: string, exp: string) => createHmac('sha256', secret).update(`${key}\n${ct}\n${len}\n${exp}`).digest('hex')
  // Same secret, different purpose prefixes: a public upload signature can never be replayed as a private one (or the reverse).
  const signPrivatePut = (key: string, ct: string, len: string, exp: string) =>
    createHmac('sha256', secret).update(`private-put\n${key}\n${ct}\n${len}\n${exp}`).digest('hex')
  const signPrivateGet = (key: string, exp: string) => createHmac('sha256', secret).update(`private-get\n${key}\n${exp}`).digest('hex')
  const sameHex = (given: string, expected: string) => {
    const a = Buffer.from(given, 'hex')
    const b = Buffer.from(expected, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  }
  return {
    kind: 'fake',
    async presignPut(key, contentType, contentLength) {
      assertPublicKey(key)
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
    publicUrl: (key) => {
      assertPublicKey(key)
      return `${DEV_UPLOAD_PREFIX}${key}`
    },
    async presignPrivatePut(key, contentType, contentLength) {
      assertPrivateKey(key)
      const exp = Date.now() + PRESIGN_EXPIRES_SECONDS * 1000
      const q = new URLSearchParams({ ct: contentType, len: String(contentLength), exp: String(exp), sig: signPrivatePut(key, contentType, String(contentLength), String(exp)) })
      return { url: `${DEV_PRIVATE_PREFIX}${key}?${q}`, headers: { 'Content-Type': contentType } }
    },
    async presignPrivateGet(key, expiresSeconds) {
      assertPrivateKey(key)
      assertPrivateGetExpiry(expiresSeconds)
      const exp = Date.now() + expiresSeconds * 1000
      const q = new URLSearchParams({ exp: String(exp), sig: signPrivateGet(key, String(exp)) })
      return `${DEV_PRIVATE_PREFIX}${key}?${q}`
    },
    async headPrivate(key) {
      assertPrivateKey(key)
      const o = privateObjects.get(key)
      return o ? { contentType: o.contentType, contentLength: o.bytes.byteLength } : null
    },
    async peekPrivate(key, length) {
      assertPrivateKey(key)
      const o = privateObjects.get(key)
      return o ? o.bytes.slice(0, length) : null
    },
    async deletePrivate(key) {
      assertPrivateKey(key)
      privateObjects.delete(key)
    },
    verifyPrivateUpload(key, q) {
      if (!isPrivateKey(key) || !q.ct || !q.len || !q.exp || !q.sig) return false
      return sameHex(q.sig, signPrivatePut(key, q.ct, q.len, q.exp)) && Number(q.exp) > Date.now()
    },
    verifyPrivateGet(key, q) {
      if (!isPrivateKey(key) || !q.exp || !q.sig) return false
      return sameHex(q.sig, signPrivateGet(key, q.exp)) && Number(q.exp) > Date.now()
    },
    put: (key, bytes, contentType) => {
      assertPublicKey(key)
      objects.set(key, { bytes, contentType })
    },
    get: (key) => objects.get(key),
    has: (key) => objects.has(key),
    putPrivate: (key, bytes, contentType) => {
      assertPrivateKey(key)
      privateObjects.set(key, { bytes, contentType })
    },
    getPrivate: (key) => {
      assertPrivateKey(key)
      return privateObjects.get(key)
    },
    hasPrivate: (key) => {
      assertPrivateKey(key)
      return privateObjects.has(key)
    },
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * R2 when every R2_* variable is set; otherwise the in-memory fake (dev/e2e) and a log line saying so.
 * The private bucket (R2_PRIVATE_*) shares R2_ENDPOINT. Half of it set is always an error.
 */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): Storage {
  const { R2_ENDPOINT, R2_PUBLIC_BUCKET, R2_PUBLIC_ACCESS_KEY_ID, R2_PUBLIC_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL } = env
  const { R2_PRIVATE_BUCKET, R2_PRIVATE_ACCESS_KEY_ID, R2_PRIVATE_SECRET_ACCESS_KEY } = env
  const privateFull = Boolean(R2_PRIVATE_BUCKET && R2_PRIVATE_ACCESS_KEY_ID && R2_PRIVATE_SECRET_ACCESS_KEY)
  const privateAny = Boolean(R2_PRIVATE_BUCKET || R2_PRIVATE_ACCESS_KEY_ID || R2_PRIVATE_SECRET_ACCESS_KEY)
  if (privateAny && !privateFull) {
    throw new Error('[storage] R2_PRIVATE_* is partly set. Set all three of R2_PRIVATE_BUCKET, R2_PRIVATE_ACCESS_KEY_ID and R2_PRIVATE_SECRET_ACCESS_KEY, or none of them.')
  }
  if (R2_ENDPOINT && R2_PUBLIC_BUCKET && R2_PUBLIC_ACCESS_KEY_ID && R2_PUBLIC_SECRET_ACCESS_KEY && R2_PUBLIC_BASE_URL) {
    const publicCfg = {
      endpoint: R2_ENDPOINT,
      bucket: R2_PUBLIC_BUCKET,
      accessKeyId: R2_PUBLIC_ACCESS_KEY_ID,
      secretAccessKey: R2_PUBLIC_SECRET_ACCESS_KEY,
      publicBaseUrl: R2_PUBLIC_BASE_URL,
    }
    if (R2_PRIVATE_BUCKET && R2_PRIVATE_ACCESS_KEY_ID && R2_PRIVATE_SECRET_ACCESS_KEY) {
      return createR2Storage({
        ...publicCfg,
        private: { bucket: R2_PRIVATE_BUCKET, accessKeyId: R2_PRIVATE_ACCESS_KEY_ID, secretAccessKey: R2_PRIVATE_SECRET_ACCESS_KEY },
      })
    }
    // KTM photos cannot be stored without the private bucket, so production must not run without it silently.
    if (env.NODE_ENV === 'production' && env.ALLOW_FAKE_STORAGE !== '1') {
      throw new Error('[storage] R2_PRIVATE_* is not fully set in production. Set every R2_PRIVATE_* variable (or ALLOW_FAKE_STORAGE=1 for e2e only).')
    }
    console.log('[storage] R2_PRIVATE_* not set: private uploads (KTM photos) are disabled.')
    return createR2Storage(publicCfg)
  }
  // The fake mounts an unauthenticated dev upload route, so production must never fall back to it
  // silently. The e2e server runs with NODE_ENV=production and opts in explicitly.
  if (env.NODE_ENV === 'production' && env.ALLOW_FAKE_STORAGE !== '1') {
    throw new Error('[storage] R2_* is not fully set in production. Set every R2_PUBLIC_* variable (or ALLOW_FAKE_STORAGE=1 for e2e only).')
  }
  console.log('[storage] R2_* not set: using the in-memory fake storage (uploads are lost on restart).')
  return createFakeStorage()
}
