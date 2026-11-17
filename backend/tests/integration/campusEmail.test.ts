import { beforeEach, describe, expect, it } from 'vitest'
import { signCampusToken } from '../../src/campusEmail.ts'
import { resetDb } from '../../src/db/seed.ts'
import { lastEmail, me, nextIp, pathOf, prisma, registerAndSignIn, request, secret } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const submit = (cookie: string, email: string, ip = nextIp()) => request('/api/auth/campus-email/request', { cookie, ip, body: { email } })
const userRow = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } })

describe('campus-email verification', () => {
  it('requires a session', async () => {
    const res = await request('/api/auth/campus-email/request', { body: { email: 'budi@student.binus.ac.id' } })
    expect(res.status).toBe(401)
  })

  it('rejects addresses that do not end in .ac.id and queues nothing', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    for (const bad of ['sari@gmail.com', 'sari@binus.edu', 'sari@fake-ac.id', 'sari@binus.ac.id.evil.com', 'bukan-email']) {
      const res = await submit(cookie, bad)
      expect(res.status, bad).toBe(400)
    }
    expect(await prisma.emailOutbox.count({ where: { template: 'campus-email' } })).toBe(0)
  })

  it('emails a signed link, and clicking it sets campusEmail and campusEmailVerifiedAt', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    expect((await submit(cookie, 'Sari@Student.Binus.ac.id')).status).toBe(200)

    const mail = await lastEmail('campus-email', 'sari@student.binus.ac.id')
    expect(mail?.status).toBe('PENDING')
    expect((await userRow('sari@example.com')).campusEmailVerifiedAt).toBeNull()

    const click = await request(pathOf(mail!.payload.url))
    expect(click.status).toBe(302)
    expect(click.headers.get('location')).toContain('campus=verified')

    const user = await userRow('sari@example.com')
    expect(user.campusEmail).toBe('sari@student.binus.ac.id')
    expect(user.campusEmailVerifiedAt).not.toBeNull()
    expect(user.campus).toBe('Binus Syahdan') // domain matched a seeded Campus.emailDomains entry
    expect((await me(cookie))?.campusVerified).toBe(true)
  })

  it('accepts a .ac.id address that matches no seeded campus', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    expect((await submit(cookie, 'sari@mahasiswa.unair.ac.id')).status).toBe(200)
    const mail = await lastEmail('campus-email', 'sari@mahasiswa.unair.ac.id')
    expect((await request(pathOf(mail!.payload.url))).status).toBe(302)
    expect((await userRow('sari@example.com')).campusEmailVerifiedAt).not.toBeNull()
  })

  it('rejects a tampered, forged or expired token and leaves the user unverified', async () => {
    await registerAndSignIn('sari@example.com')
    const user = await userRow('sari@example.com')
    const claim = { userId: user.id, email: 'sari@student.binus.ac.id' }
    const good = signCampusToken(secret, claim, 3600)
    const expired = signCampusToken(secret, claim, -1)
    const forged = signCampusToken('another-secret-another-secret-0123456789', claim, 3600)
    const [body, sig] = good.split('.')
    const swapped = `${body}.${sig.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))}`

    for (const token of [expired, forged, swapped, 'sampah']) {
      const res = await request(`/api/auth/campus-email/verify?token=${encodeURIComponent(token)}`)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('campus=invalid')
    }
    expect((await userRow('sari@example.com')).campusEmailVerifiedAt).toBeNull()
  })

  it('does not let a second account claim an already-verified campus email', async () => {
    const first = await registerAndSignIn('a@example.com')
    await submit(first, 'budi@student.binus.ac.id')
    await request(pathOf((await lastEmail('campus-email', 'budi@student.binus.ac.id'))!.payload.url))

    const second = await registerAndSignIn('b@example.com')
    expect((await submit(second, 'budi@student.binus.ac.id')).status).toBe(409)
  })

  it('is rate-limited to 3 sends per minute per client', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    const ip = nextIp()
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await submit(cookie, `sari${i}@student.binus.ac.id`, ip)).status)
    expect(statuses).toEqual([200, 200, 200, 429])
  })
})
