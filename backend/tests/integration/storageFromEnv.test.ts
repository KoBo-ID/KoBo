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
