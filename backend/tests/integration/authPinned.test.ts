// C-10: pins B03-001 (password reset revokes other sessions) and B05-001 (/update-user field bounds).
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { cookieFrom, lastEmail, me, pathOf, prisma, registerAndSignIn, request } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const EMAIL = 'pinned@example.com'
const OLD = 'Sandi-rahasia-123'
const NEW = 'Sandi-baru-98765'

describe('B03-001: a password reset revokes every session', () => {
  it('signs out the sessions that existed before the reset and accepts only the new password', async () => {
    const first = await registerAndSignIn(EMAIL, OLD)
    const second = cookieFrom(await request('/api/auth/sign-in/email', { body: { email: EMAIL, password: OLD } }))
    expect((await me(first))?.user.email).toBe(EMAIL)
    expect((await me(second))?.user.email).toBe(EMAIL)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })
    expect(await prisma.session.count({ where: { userId: user.id } })).toBeGreaterThanOrEqual(2)

    await request('/api/auth/request-password-reset', { body: { email: EMAIL, redirectTo: '/reset-password' } })
    const mail = await lastEmail('reset-password', EMAIL)
    const click = await request(pathOf(mail!.payload.url))
    const token = new URL(click.headers.get('location')!, 'http://localhost').searchParams.get('token')
    expect(token).toBeTruthy()
    expect((await request('/api/auth/reset-password', { body: { newPassword: NEW, token } })).status).toBe(200)

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
    expect(await me(first)).toBeNull()
    expect(await me(second)).toBeNull()
    expect((await request('/api/auth/sign-in/email', { body: { email: EMAIL, password: OLD } })).status).toBe(401)
    expect((await request('/api/auth/sign-in/email', { body: { email: EMAIL, password: NEW } })).status).toBe(200)
  })
})

describe('B05-001: /api/auth/update-user applies the profile limits', () => {
  const update = (cookie: string, body: Record<string, unknown>) => request('/api/auth/update-user', { cookie, body })

  it.each([
    ['a name over 80 characters', { name: 'A'.repeat(81) }],
    ['an empty name', { name: '   ' }],
    ['a malformed phone number', { phone: 'abc-not-a-phone' }],
    ['a phone number that is too long', { phone: '0'.repeat(40) }],
    ['a campus over 80 characters', { campus: 'K'.repeat(81) }],
  ])('refuses %s and leaves the profile untouched', async (_label, body) => {
    const cookie = await registerAndSignIn(EMAIL, OLD, 'Nama Asli')
    const before = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })
    const res = await update(cookie, body)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    const after = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })
    expect([after.name, after.phone, after.campus]).toEqual([before.name, before.phone, before.campus])
  })

  it('accepts values at the limits, trims them, and stores them', async () => {
    const cookie = await registerAndSignIn(EMAIL, OLD)
    const res = await update(cookie, { name: `  ${'B'.repeat(80)}  `, phone: ' +62 812-3456-7890 ', campus: 'K'.repeat(80) })
    expect(res.status).toBe(200)
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })
    expect(row).toMatchObject({ name: 'B'.repeat(80), phone: '+62 812-3456-7890', campus: 'K'.repeat(80) })
  })
})
