import type { OwnerDocKind } from '@kobo/shared/schemas'
import { hasImageSignature } from '../storage.ts'

export const OWNER_DOC_PREFIX = 'private/owner-docs/'
export const OWNER_DOC_MAX_BYTES = 10_000_000
export const OWNER_DOC_TYPES = ['image/jpeg', 'image/webp', 'application/pdf'] as const
export const OWNER_MAX_ATTEMPTS = 3
/** Files are kept this long after a decision, then purged by the retention job. */
export const OWNER_DOC_RETENTION_DAYS = 90

/** Land-rights documents in the owner's own name (Q6). */
export const OWNER_LAND_KINDS: readonly OwnerDocKind[] = ['SHM', 'SHGB', 'AJB', 'GIRIK', 'SPPT_PBB']

export const OWNER_KEY_PREFIX = (userId: string) => `${OWNER_DOC_PREFIX}${userId}/`

/** The key must sit directly under the caller's own prefix: private/owner-docs/{userId}/{id}. */
export function isOwnKey(userId: string, key: string): boolean {
  const prefix = OWNER_KEY_PREFIX(userId)
  if (!key.startsWith(prefix) || key.includes('..')) return false
  const rest = key.slice(prefix.length)
  return rest.length > 0 && !rest.includes('/')
}

/** JPEG, WebP or `%PDF-`. A signature check on the first bytes, not a decode. */
export function hasOwnerDocSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === 'application/pdf') return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-'
  return hasImageSignature(contentType, bytes)
}

/**
 * Q6: which kinds an owner must have (approved ones kept + the new ones) for the declared role. Null when complete,
 * else an Indonesian message. An undeclared role is treated as PEMILIK, the strictest plain case.
 */
export function ownerDocsProblem(ownershipType: string | null, kinds: ReadonlySet<OwnerDocKind>): string | null {
  if (!kinds.has('KTP')) return 'Sertakan KTP pemilik.'
  const hasLand = OWNER_LAND_KINDS.some((k) => kinds.has(k))
  if (ownershipType === 'PENGELOLA_KUASA') {
    if (!hasLand) return 'Sertakan dokumen tanah milik pemilik (SHM, SHGB, AJB, Girik, atau SPPT PBB).'
    if (!kinds.has('SURAT_KUASA')) return 'Sertakan surat kuasa dari pemilik.'
    return null
  }
  if (ownershipType === 'LAINNYA') return kinds.has('SURAT_KETERANGAN') ? null : 'Sertakan surat keterangan atau perjanjian pengelolaan.'
  return hasLand ? null : 'Sertakan bukti kepemilikan (SHM, SHGB, AJB, Girik, atau SPPT PBB).'
}
