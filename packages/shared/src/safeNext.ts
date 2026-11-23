/** Longest `next` value worth honouring; anything longer is junk or an attack and falls back. */
export const MAX_NEXT_LENGTH = 512

/**
 * The one parser for `?next=` redirect targets (G2-17). Returns a same-origin path (with query and hash), or `fallback`.
 * Parses with `URL` instead of prefix-matching, because browsers read "/\evil.com" and "/\t/evil.com" as "//evil.com".
 * Backslashes and control characters are refused outright, and the sign-in page itself is never a target
 * (case- and percent-encoding-insensitive, like the router).
 */
export function safeNextPath(raw: string | null | undefined, origin: string, fallback = '/'): string {
  if (!raw || raw.length > MAX_NEXT_LENGTH || !raw.startsWith('/')) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback
  let u: URL
  try {
    u = new URL(raw, origin)
  } catch {
    return fallback
  }
  if (u.origin !== new URL(origin).origin) return fallback
  let path: string
  try {
    path = decodeURIComponent(u.pathname).toLowerCase()
  } catch {
    return fallback
  }
  if (path.includes('\\') || path.startsWith('//')) return fallback
  const blocked = ['/masuk', '/reset-password', '/verifikasi-email']
  if (blocked.some((b) => path === b || path.startsWith(`${b}/`))) return fallback
  return u.pathname + u.search + u.hash
}
