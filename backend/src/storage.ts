import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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
  delete(key: string): Promise<void>
  publicUrl(key: string): string
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
}

export function createFakeStorage(): FakeStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  return {
    kind: 'fake',
    async presignPut(key, contentType, contentLength) {
      const exp = Date.now() + PRESIGN_EXPIRES_SECONDS * 1000
      const q = new URLSearchParams({ ct: contentType, len: String(contentLength), exp: String(exp) })
      return { url: `${DEV_UPLOAD_PREFIX}${key}?${q}`, headers: { 'Content-Type': contentType } }
    },
    async head(key) {
      const o = objects.get(key)
      return o ? { contentType: o.contentType, contentLength: o.bytes.byteLength } : null
    },
    async delete(key) {
      objects.delete(key)
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
