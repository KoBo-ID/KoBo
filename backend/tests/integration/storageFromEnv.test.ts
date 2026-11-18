import { describe, expect, it } from 'vitest'
import { storageFromEnv } from '../../src/storage.ts'

describe('storageFromEnv', () => {
  it('refuses to fall back to the fake storage in production', () => {
    expect(() => storageFromEnv({ NODE_ENV: 'production' })).toThrow(/R2_/)
  })

  it('allows the fake in production only with the explicit e2e opt-in', () => {
    expect(storageFromEnv({ NODE_ENV: 'production', ALLOW_FAKE_STORAGE: '1' }).kind).toBe('fake')
  })

  it('uses the fake outside production', () => {
    expect(storageFromEnv({ NODE_ENV: 'development' }).kind).toBe('fake')
  })
})

const R2_PUBLIC = {
  R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  R2_PUBLIC_BUCKET: 'kobo-public',
  R2_PUBLIC_ACCESS_KEY_ID: 'public-key-id',
  R2_PUBLIC_SECRET_ACCESS_KEY: 'public-secret',
  R2_PUBLIC_BASE_URL: 'https://cdn.example.test',
}
const R2_PRIVATE = {
  R2_PRIVATE_BUCKET: 'kobo-private',
  R2_PRIVATE_ACCESS_KEY_ID: 'private-key-id',
  R2_PRIVATE_SECRET_ACCESS_KEY: 'private-secret',
}

describe('storageFromEnv private bucket', () => {
  it('refuses production R2 without the R2_PRIVATE_* variables', () => {
    expect(() => storageFromEnv({ NODE_ENV: 'production', ...R2_PUBLIC })).toThrow(/R2_PRIVATE_\* is not fully set in production/)
  })

  it('refuses a half-configured private bucket, even outside production', () => {
    expect(() => storageFromEnv({ NODE_ENV: 'development', ...R2_PUBLIC, R2_PRIVATE_BUCKET: 'kobo-private' })).toThrow(/R2_PRIVATE_\* is partly set/)
    expect(() => storageFromEnv({ NODE_ENV: 'development', R2_PRIVATE_SECRET_ACCESS_KEY: 'x' })).toThrow(/R2_PRIVATE_\* is partly set/)
  })

  it('selects R2 with the private bucket when every variable is set', async () => {
    const s = storageFromEnv({ NODE_ENV: 'production', ...R2_PUBLIC, ...R2_PRIVATE })
    expect(s.kind).toBe('r2')
    // Presigning is local signing (no network call): the URL names the private bucket.
    const url = await s.presignPrivateGet('private/ktm/test.webp', 60)
    expect(url).toContain('kobo-private')
    expect(url).toContain('private/ktm/test.webp')
  })

  it('returns R2 without private uploads in development when only the public bucket is set', async () => {
    const s = storageFromEnv({ NODE_ENV: 'development', ...R2_PUBLIC })
    expect(s.kind).toBe('r2')
    await expect(s.presignPrivateGet('private/ktm/test.webp', 60)).rejects.toThrow(/private bucket is not configured/)
  })
})
