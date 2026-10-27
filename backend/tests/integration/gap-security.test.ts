import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { app, approveApplication, baseURL, caller, callerFor, newStudent, postXenditWebhook, prisma, registerAndSignIn, request, sessionWebhook, TEST_BUSINESS_ID, TEST_CALLBACK_TOKEN, vacantRoom } from '../helpers.ts'
import { pendingApplication, startIn, twoOwners } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

async function pendingXenditAttempt() {
  const room = await vacantRoom()
  const student = await newStudent()
  const res = await approveApplication(student.id, room.id, { durationMonths: 3 })
  const payment = await prisma.payment.create({
    data: { invoiceId: res.invoiceId, provider: 'XENDIT', status: 'PENDING', amount: res.invoice.amount, providerSessionId: `ps_${res.invoiceId}`, providerBusinessId: TEST_BUSINESS_ID },
  })
  return { res, payment }
}

describe('[G-038][R-024] a callback that is only almost right never credits', () => {
  it('ignores GET, a token in the query string, and a token in the wrong header; the exact request does credit', async () => {
    const { res, payment } = await pendingXenditAttempt()
    const body = JSON.stringify(sessionWebhook('completed', payment))
    const state = async () => ({
      payment: (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      invoice: (await prisma.invoice.findUniqueOrThrow({ where: { id: res.invoiceId } })).status,
      tenancy: (await prisma.tenancy.findUniqueOrThrow({ where: { id: res.tenancyId } })).status,
    })

    const attempts: Response[] = []
    attempts.push(await app.request('/api/webhooks/xendit', { method: 'GET', headers: { 'x-callback-token': TEST_CALLBACK_TOKEN } }))
    attempts.push(await app.request(`/api/webhooks/xendit?x-callback-token=${TEST_CALLBACK_TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }))
    attempts.push(await app.request('/api/webhooks/xendit', { method: 'POST', headers: { 'content-type': 'application/json', authorization: TEST_CALLBACK_TOKEN, 'x-token': TEST_CALLBACK_TOKEN }, body }))
    for (const r of attempts) expect(r.status).toBeGreaterThanOrEqual(400)
    expect(await state()).toEqual({ payment: 'PENDING', invoice: 'UNPAID', tenancy: 'PENDING' })
    expect(await prisma.paymentWebhookEvent.count()).toBe(0)

    expect((await postXenditWebhook(JSON.parse(body))).status).toBe(200)
    expect(await state()).toEqual({ payment: 'PAID', invoice: 'PAID', tenancy: 'ACTIVE' })
  })
})

describe('[G-039][R-105] same origin, no CORS', () => {
  it('sends no Access-Control-Allow-Origin to a foreign origin, on tRPC, on auth and on a preflight', async () => {
    const evil = { origin: 'https://evil.example' }
    const responses = [
      await request('/api/trpc/kos.list', { headers: evil }),
      await request('/api/auth/get-session', { headers: evil }),
      await app.request('/api/trpc/kos.list', { method: 'OPTIONS', headers: { ...evil, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } }),
    ]
    for (const r of responses) {
      expect(r.headers.get('access-control-allow-origin')).toBeNull()
      expect(r.headers.get('access-control-allow-credentials')).toBeNull()
    }
  })
})

describe('[G-040][R-106] session cookie flags (the foreign-origin check needs a production-mode server: see e2e/tests/gap-security.spec.ts)', () => {
  it('never sets a SameSite=None cookie', async () => {
    const email = `gap-cookie-${Date.now()}@kobo.test`
    await registerAndSignIn(email)
    const ok = await request('/api/auth/sign-in/email', { body: { email, password: 'Sandi-rahasia-123' } })
    expect(ok.status).toBe(200)
    const cookies = ok.headers.getSetCookie()
    expect(cookies.length).toBeGreaterThan(0)
    for (const c of cookies) expect(c).not.toMatch(/samesite=none/i)
  })
})

describe('[G-042][R-100] public and student-facing payloads leak nothing private', () => {
  it('contains no credential field and no other account\'s email, nor a non-owner\'s phone', async () => {
    await prisma.user.updateMany({ where: { phone: null }, data: { phone: '0812999000' } })
    const { a } = await twoOwners()
    const kosId = a.kos[0]!.id
    const mine = await newStudent()
    await prisma.user.update({ where: { id: mine.id }, data: { phone: '0812111222' } })
    // Owner contact details on a listing may be intentional (UNSPECIFIED); every other account's email, and every non-owner's phone, must stay private.
    const others = await prisma.user.findMany({ where: { id: { not: mine.id } }, select: { email: true, phone: true, ownerProfile: { select: { id: true } } } })
    const payloads: Record<string, unknown> = {
      'kos.list': await caller.kos.list(),
      'kos.detail': await caller.kos.detail({ id: kosId }),
      'kos.search': await caller.kos.search({}),
      'owner.publicProfile': await caller.owner.publicProfile({ id: a.id }),
      'waitlist.status': await caller.waitlist.status({ kosId }),
      'kos.detail (student)': await callerFor(mine.id).kos.detail({ id: kosId }),
      'application.mine': await callerFor(mine.id).application.mine(),
      'booking.mine': await callerFor(mine.id).booking.mine(),
      'visit.mine': await callerFor(mine.id).visit.mine(),
    }
    const credentialKey = /"(password|passwordHash|hash|salt|accessToken|refreshToken|idToken|callbackToken|callback_token|apiKey|secret)"\s*:/i
    for (const [name, payload] of Object.entries(payloads)) {
      const json = JSON.stringify(payload)
      expect(credentialKey.test(json), `${name} exposes a credential field`).toBe(false)
      for (const o of others) {
        expect(json.includes(`"${o.email}"`), `${name} exposes ${o.email}`).toBe(false)
        if (o.phone && !o.ownerProfile) expect(json.includes(o.phone), `${name} exposes a non-owner phone number`).toBe(false)
      }
    }
  })
})

describe('[G-043][R-093] the owner inbox never carries the emergency contact', () => {
  it('keeps the emergency contact out of application.ownerList, owner.visits and owner.waitlistEntries before approval', async () => {
    const { a } = await twoOwners()
    const kosId = a.kos[0]!.id
    const room = await prisma.room.findFirstOrThrow({ where: { kosId, tenancies: { none: { status: { in: ['ACTIVE', 'PENDING'] } } } } })
    const { renter } = await pendingApplication(room.id)
    await prisma.user.update({
      where: { id: renter.id },
      data: { phone: '0812777000', emergencyContactName: 'Bu Rahasia', emergencyContactRelation: 'Ibu', emergencyContactPhone: '0812888999', emergencyContactConsentAt: new Date() },
    })
    await callerFor(renter.id).visit.create({ kosId, date: startIn(3), timeSlot: 'PAGI' })
    const owner = callerFor(a.userId)
    const payloads = [await owner.application.ownerList({ kosId }), await owner.owner.visits({ kosId }), await owner.owner.waitlistEntries({ kosId })]
    for (const p of payloads) {
      const json = JSON.stringify(p)
      expect(json).not.toContain('Bu Rahasia')
      expect(json).not.toContain('0812888999')
    }
  })
})

describe('[G-044][R-108] sign-up input limits', () => {
  // F-002 (fixed): better-auth stored any sign-up name length; profile editing caps it at 80.
  it('refuses a name over the 80-character profile limit and creates no account', async () => {
    const email = `gap-name-${Date.now()}@kobo.test`
    const res = await request('/api/auth/sign-up/email', { body: { name: 'x'.repeat(81), email, password: 'Sandi-rahasia-123' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'INVALID_PROFILE', message: 'Nama terlalu panjang (maksimal 80 karakter).' })
    expect(await prisma.user.count({ where: { email } })).toBe(0)
  })

  it('accepts a name of exactly 80 characters', async () => {
    const email = `gap-name80-${Date.now()}@kobo.test`
    const res = await request('/api/auth/sign-up/email', { body: { name: 'x'.repeat(80), email, password: 'Sandi-rahasia-123' } })
    expect(res.status).toBe(200)
    expect(await prisma.user.count({ where: { email } })).toBe(1)
  })

  it('answers a 2 MB body with a 413 and never a stored account', async () => {
    const email = `gap-big-${Date.now()}@kobo.test`
    const res = await request('/api/auth/sign-up/email', { body: { name: 'x'.repeat(2_000_000), email, password: 'Sandi-rahasia-123' } })
    expect(res.status).toBe(413)
    expect(await prisma.user.count({ where: { email } })).toBe(0)
  })

  it('answers a 2 MB streamed body without Content-Length with a 413 and no account', async () => {
    const email = `gap-stream-${Date.now()}@kobo.test`
    const enc = new TextEncoder()
    const head = enc.encode(`{"email":"${email}","password":"Sandi-rahasia-123","name":"`)
    const chunk = enc.encode('x'.repeat(64 * 1024))
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (sent === 0) ctl.enqueue(head)
        else if (sent <= 32) ctl.enqueue(chunk)
        else {
          ctl.enqueue(enc.encode('"}'))
          ctl.close()
        }
        sent++
      },
    })
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { origin: baseURL, 'content-type': 'application/json', 'cf-connecting-ip': '10.77.0.9' },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(res.status).toBe(413)
    expect(await prisma.user.count({ where: { email } })).toBe(0)
  })
})

describe('[G-041][R-107] origin and login CSRF on cookie-less auth routes', () => {
  const creds = (tag: string) => ({ email: `gap-origin-${tag}-${Date.now()}@kobo.test`, password: 'Sandi-rahasia-123', name: 'Origin Test' })
  const bare = (path: string, headers: Record<string, string>, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...headers }, body: JSON.stringify(body) })

  it('refuses a cookie-less sign-in and sign-up that carry a foreign Origin', async () => {
    const c = creds('evil')
    const up = await bare('/api/auth/sign-up/email', { origin: 'https://evil.example' }, c)
    expect(up.status).toBe(403)
    expect(await prisma.user.count({ where: { email: c.email } })).toBe(0)
    const inn = await bare('/api/auth/sign-in/email', { origin: 'https://evil.example' }, { email: c.email, password: c.password })
    expect(inn.status).toBe(403)
    expect(inn.headers.getSetCookie()).toEqual([])
  })

  it('refuses a cross-site navigation by Fetch Metadata even without cookies', async () => {
    const c = creds('nav')
    const res = await bare('/api/auth/sign-in/email', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, { email: c.email, password: c.password })
    expect(res.status).toBe(403)
  })

  it('accepts the app own Origin, and a request with neither Origin nor Referer (curl, native clients)', async () => {
    const own = creds('own')
    expect((await bare('/api/auth/sign-up/email', { origin: baseURL }, own)).status).toBe(200)
    const none = creds('none')
    expect((await bare('/api/auth/sign-up/email', {}, none)).status).toBe(200)
  })
})
