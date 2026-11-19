import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safeNext.ts'

const O = 'https://kobo.example'

describe('safeNextPath (G2-17)', () => {
  it('keeps a same-origin path with query and hash', () => {
    expect(safeNextPath('/kos/kos-1?room=r1#foto', O)).toBe('/kos/kos-1?room=r1#foto')
    expect(safeNextPath('/owner/dashboard', O, '/owner/login')).toBe('/owner/dashboard')
  })

  it('falls back for empty, missing and over-long values', () => {
    expect(safeNextPath(null, O)).toBe('/')
    expect(safeNextPath(undefined, O)).toBe('/')
    expect(safeNextPath('', O, '/x')).toBe('/x')
    expect(safeNextPath('/' + 'a'.repeat(600), O)).toBe('/')
  })

  it.each([
    '//evil.com',
    '/\\evil.com',
    '/\\\\evil.com',
    '/%5Cevil.com',
    '%2F%2Fevil.com',
    'https://evil.com',
    'javascript:alert(1)',
    '/\t/evil.com',
    '/\r\n/evil.com',
    '/\\/evil.com',
    ' //evil.com',
    'evil.com',
  ])('refuses %j', (raw) => {
    expect(safeNextPath(raw, O)).toBe('/')
  })

  it.each(['/masuk', '/Masuk', '/MASUK?next=/x', '/%6Dasuk', '/masuk/'])('never returns to the sign-in page itself (%j)', (raw) => {
    expect(safeNextPath(raw, O, '/home')).toBe('/home')
  })

  it('does not treat other paths that merely start with masuk as the sign-in page', () => {
    expect(safeNextPath('/masukan', O)).toBe('/masukan')
  })
})
