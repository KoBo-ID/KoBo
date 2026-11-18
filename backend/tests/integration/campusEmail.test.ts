import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.ts'
import { createAuth } from '../../src/auth.ts'
import { campusForDomain, codeMatches, defaultMxResolver, generateCampusCode, hashCampusCode } from '../../src/campusEmail.ts'
import { resetDb } from '../../src/db/seed.ts'
import { renderEmail } from '../../src/emailTemplates.ts'
import { baseURL, lastEmail, me, nextIp, paymentService, prisma, registerAndSignIn, request, secret, storage } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const submit = (cookie: string, email: string, ip = nextIp()) => request('/api/auth/campus-email/request', { cookie, ip, body: { email } })
const confirm = (cookie: string, code: string, ip = nextIp()) => request('/api/auth/campus-email/confirm', { cookie, ip, body: { code } })
const userRow = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } })
const codeOf = async (to: string) => (await lastEmail('campus-email', to))!.payload as unknown as { code: string }
const errCode = async (res: Response) => ((await res.json()) as { code?: string }).code
const wrongCode = (code: string) => (code === '000000' ? '000001' : '000000')

describe('campus-email helpers', () => {
  it('matches a campus domain exactly: no .ac.id wildcard, no subdomain wildcard, case-insensitive', () => {
    const campuses = [{ id: 1, studentEmailDomains: ['binus.ac.id'] }, { id: 2, studentEmailDomains: ['Students.ITB.ac.id'] }]
    expect(campusForDomain('binus.ac.id', campuses)?.id).toBe(1)
    expect(campusForDomain('students.itb.ac.id', campuses)?.id).toBe(2)
    for (const no of ['student.binus.ac.id', 'itb.ac.id', 'binus.ac.id.evil.com', 'xbinus.ac.id', 'unair.ac.id', '']) expect(campusForDomain(no, campuses), no).toBeUndefined()
  })

  it('codes are 6 digits, hashed per challenge', () => {
    for (let i = 0; i < 50; i++) expect(generateCampusCode()).toMatch(/^\d{6}$/)
    const h = hashCampusCode(secret, 'c1', '123456')
    expect(h).not.toContain('123456')
    expect(codeMatches(secret, 'c1', '123456', h)).toBe(true)
    expect(codeMatches(secret, 'c2', '123456', h)).toBe(false)
    expect(codeMatches(secret, 'c1', '123457', h)).toBe(false)
  })

  it('the default MX resolver is the offline fake under tests', async () => {
    expect(await defaultMxResolver()('no-such-domain.invalid')).toBe(true)
  })
})

describe('campus-email verification', () => {
  it('requires a session', async () => {
    const res = await request('/api/auth/campus-email/request', { body: { email: 'budi@binus.ac.id' } })
    expect(res.status).toBe(401)
    expect((await request('/api/auth/campus-email/confirm', { body: { code: '123456' } })).status).toBe(401)
  })

  it('refuses domains that are not a curated student domain, with an Indonesian code, and queues nothing', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    for (const bad of ['sari@gmail.com', 'sari@student.binus.ac.id', 'sari@fake-ac.id', 'sari@binus.ac.id.evil.com', 'sari@mahasiswa.unair.ac.id']) {
      const res = await submit(cookie, bad)
      expect(res.status, bad).toBe(400)
      const body = (await res.json()) as { code: string; message: string }
      expect(body.code, bad).toBe('CAMPUS_EMAIL_DOMAIN_UNKNOWN')
      expect(body.message).toContain('belum terdaftar sebagai email mahasiswa')
    }
    expect((await submit(cookie, 'bukan-email')).status).toBe(400)
    expect(await prisma.emailOutbox.count({ where: { template: 'campus-email' } })).toBe(0)
    expect(await prisma.campusEmailChallenge.count()).toBe(0)
  })

  it('refuses a curated domain with no MX record (injected resolver)', async () => {
    const noMx = createApp({ prisma, auth: createAuth({ prisma, baseURL, secret, campusMx: async () => false }), storage, paymentService })
    const cookie = await registerAndSignIn('sari@example.com')
    const res = await noMx.request('/api/auth/campus-email/request', {
      method: 'POST',
      headers: { origin: baseURL, cookie, 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
      body: JSON.stringify({ email: 'sari@binus.ac.id' }),
    })
    expect(res.status).toBe(400)
    expect(await errCode(res)).toBe('CAMPUS_EMAIL_NO_MX')
    expect(await prisma.emailOutbox.count({ where: { template: 'campus-email' } })).toBe(0)
  })

  it('emails a code only (no URL anywhere); confirming verifies for 365 days and maps the campus', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    expect((await submit(cookie, 'Sari@Binus.AC.id')).status).toBe(200)

    const mail = await lastEmail('campus-email', 'sari@binus.ac.id')
    expect(mail?.status).toBe('PENDING')
    const { code } = await codeOf('sari@binus.ac.id')
    expect(code).toMatch(/^\d{6}$/)
    expect(mail?.payload.url).toBeUndefined()
    const rendered = renderEmail('campus-email', mail!.payload)!
    expect(rendered.text).toContain(code)
    for (const body of [rendered.text, rendered.html]) expect(body).not.toMatch(/https?:|href=|www\./i)
    const row = await prisma.campusEmailChallenge.findFirstOrThrow()
    expect(row.codeHash).not.toContain(code)
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(9 * 60_000)
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(10 * 60_000 + 1000)
    expect((await userRow('sari@example.com')).campusEmailVerifiedAt).toBeNull()

    expect((await confirm(cookie, code)).status).toBe(200)
    const user = await userRow('sari@example.com')
    expect(user.campusEmail).toBe('sari@binus.ac.id')
    expect(user.campusEmailVerifiedAt).not.toBeNull()
    expect(user.campusVerifiedVia).toBe('EMAIL')
    const days = (user.campusVerifiedUntil!.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(364)
    expect(days).toBeLessThanOrEqual(365)
    expect(user.campus).toMatch(/^Binus/) // mapped from Campus.studentEmailDomains
    expect((await me(cookie))?.campusVerified).toBe(true)
  })

  it('the old link endpoint is gone: GET /campus-email/verify is 404 and verifies nobody', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    await submit(cookie, 'sari@binus.ac.id')
    for (const token of ['x.y', 'sampah', '']) {
      const res = await request(`/api/auth/campus-email/verify?token=${token}`)
      expect(res.status).toBe(404)
    }
    expect((await userRow('sari@example.com')).campusEmailVerifiedAt).toBeNull()
  })

  it('a new request invalidates the older challenge (its code)', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    await submit(cookie, 'sari@binus.ac.id')
    const first = await codeOf('sari@binus.ac.id')
    await submit(cookie, 'sari@binus.ac.id')
    const second = await codeOf('sari@binus.ac.id')
    // The code of the older challenge never matches the live one (a 1-in-a-million collision is retried below).
    if (first.code !== second.code) expect(await errCode(await confirm(cookie, first.code))).toBe('CAMPUS_CODE_INVALID')
    expect((await confirm(cookie, second.code)).status).toBe(200)
  })

  it('confirms with the code, once', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    await submit(cookie, 'sari@binus.ac.id')
    const { code } = await codeOf('sari@binus.ac.id')
    expect((await confirm(cookie, code)).status).toBe(200)
    const user = await userRow('sari@example.com')
    expect([user.campusEmail, user.campusVerifiedVia]).toEqual(['sari@binus.ac.id', 'EMAIL'])
    expect(user.campusEmailVerifiedAt).not.toBeNull()
    expect(await errCode(await confirm(cookie, code))).toBe('CAMPUS_CODE_EXPIRED') // consumed
  })

  it('a wrong code counts an attempt; the 5th wrong attempt kills the challenge even for the right code', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    await submit(cookie, 'sari@binus.ac.id')
    const { code } = await codeOf('sari@binus.ac.id')
    for (let i = 1; i <= 5; i++) {
      const res = await confirm(cookie, wrongCode(code))
      expect(res.status).toBe(400)
      expect(await errCode(res)).toBe('CAMPUS_CODE_INVALID')
      expect((await prisma.campusEmailChallenge.findFirstOrThrow()).attempts).toBe(i)
    }
    const dead = await confirm(cookie, code)
    expect(dead.status).toBe(400)
    expect(await errCode(dead)).toBe('CAMPUS_CODE_EXPIRED')
    expect((await userRow('sari@example.com')).campusEmailVerifiedAt).toBeNull()
  })

  it('refuses an expired code, a malformed code, and a code for someone else\'s challenge', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    const other = await registerAndSignIn('budi@example.com')
    await submit(cookie, 'sari@binus.ac.id')
    const { code } = await codeOf('sari@binus.ac.id')
    expect((await confirm(cookie, '12ab')).status).toBe(400)
    expect(await errCode(await confirm(other, code))).toBe('CAMPUS_CODE_EXPIRED') // budi has no challenge
    await prisma.campusEmailChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    const res = await confirm(cookie, code)
    expect(res.status).toBe(400)
    expect(await errCode(res)).toBe('CAMPUS_CODE_EXPIRED')
  })

  it('does not let a second account claim an already-verified campus email', async () => {
    const first = await registerAndSignIn('a@example.com')
    await submit(first, 'budi@binus.ac.id')
    expect((await confirm(first, (await codeOf('budi@binus.ac.id')).code)).status).toBe(200)

    const second = await registerAndSignIn('b@example.com')
    const res = await submit(second, 'budi@binus.ac.id')
    expect(res.status).toBe(409)
    expect(await errCode(res)).toBe('CAMPUS_EMAIL_TAKEN')
  })

  it('two accounts racing for one mailbox: exactly one wins, the other gets CAMPUS_EMAIL_TAKEN', async () => {
    const a = await registerAndSignIn('a@example.com')
    const b = await registerAndSignIn('b@example.com')
    await submit(a, 'budi@binus.ac.id')
    const aMail = await codeOf('budi@binus.ac.id')
    await submit(b, 'budi@binus.ac.id') // allowed: nobody has verified it yet
    const bMail = await codeOf('budi@binus.ac.id')
    expect((await confirm(a, aMail.code)).status).toBe(200)
    expect((await userRow('b@example.com')).campusEmailVerifiedAt).toBeNull()
    expect(await errCode(await confirm(b, bMail.code))).toBe('CAMPUS_EMAIL_TAKEN')
  })

  it('is rate-limited: 3 sends and 10 confirms per minute per client', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    const ip = nextIp()
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await submit(cookie, `sari${i}@binus.ac.id`, ip)).status)
    expect(statuses).toEqual([200, 200, 200, 429])

    const ip2 = nextIp()
    const confirms: number[] = []
    for (let i = 0; i < 11; i++) confirms.push((await confirm(cookie, '000000', ip2)).status)
    expect(confirms.slice(0, 10).every((s) => s !== 429)).toBe(true)
    expect(confirms[10]).toBe(429)
  })
})
