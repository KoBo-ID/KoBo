import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.ts'
import { createAuth } from '../../src/auth.ts'
import { createCampusIdp, MICROSOFT_CONSUMER_TENANT, validateClaims } from '../../src/campusIdp.ts'
import { resetDb } from '../../src/db/seed.ts'
import { baseURL, cookieFrom, demoCookie, nextIp, paymentService, prisma, registerAndSignIn, secret, storage } from '../helpers.ts'

/* No external network: the token endpoint is a fake fetch, and ID tokens are signed with a local key pair served as the JWKS
 * by a local HTTP server, so verification runs through the real jose remote-JWKS path. */

let jwksKeys: Record<string, unknown>[] = []
let jwksHits = 0
let jwksServer: Server
let jwksUrl = ''

const MS = { clientId: 'ms-client-id', clientSecret: 'ms-secret' }
const GOOGLE = { clientId: 'google-client-id', clientSecret: 'google-secret' }
const KID = 'test-key-1'
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
let jwk: Record<string, unknown>

/** code -> ID token the fake token endpoint hands out; also records the PKCE verifier it received. */
const issued = new Map<string, string>()
const verifiers = new Map<string, string>()

const fakeFetch = (async (_url: string, init: RequestInit) => {
  const form = new URLSearchParams(init.body as URLSearchParams)
  const code = form.get('code') ?? ''
  verifiers.set(code, form.get('code_verifier') ?? '')
  const idToken = issued.get(code)
  return idToken ? new Response(JSON.stringify({ id_token: idToken }), { status: 200 }) : new Response('{}', { status: 400 })
}) as unknown as typeof fetch

let idp: ReturnType<typeof createCampusIdp>
let app: ReturnType<typeof createApp>

const call = (a: ReturnType<typeof createApp>, path: string, opts: { cookie?: string; ip?: string } = {}) =>
  Promise.resolve(a.request(path, { method: 'GET', headers: { origin: baseURL, 'cf-connecting-ip': opts.ip ?? nextIp(), ...(opts.cookie ? { cookie: opts.cookie } : {}) } }))

const NOW = () => Math.floor(Date.now() / 1000)
let codeSeq = 0

async function mint(provider: 'microsoft' | 'google', nonce: string, over: Record<string, unknown> = {}, opts: { kid?: string } = {}) {
  const base =
    provider === 'microsoft'
      ? { iss: `https://login.microsoftonline.com/${over.tid ?? 'tid-x'}/v2.0`, aud: MS.clientId, tid: 'tid-x', oid: 'oid-1', email: 'someone@elsewhere.example', preferred_username: 'someone@elsewhere.example' }
      : { iss: 'https://accounts.google.com', aud: GOOGLE.clientId, sub: 'sub-1', hd: 'binus.ac.id', email: 'someone@elsewhere.example' }
  const payload: Record<string, unknown> = { ...base, nonce, exp: NOW() + 3600, iat: NOW(), ...over }
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k]
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? KID }).sign(privateKey)
}

interface Flow {
  state: string
  nonce: string
  cookie: string // session cookie + flow cookie
  location: URL
  startRes: Response
}

async function start(sessionCookie: string, provider: 'microsoft' | 'google', a = app): Promise<Flow> {
  const res = await call(a, `/api/auth/campus-idp/start?provider=${provider}`, { cookie: sessionCookie })
  expect(res.status, 'start').toBe(302)
  const location = new URL(res.headers.get('location')!)
  return { state: location.searchParams.get('state')!, nonce: location.searchParams.get('nonce')!, cookie: `${sessionCookie}; ${cookieFrom(res)}`, location, startRes: res }
}

/** Run start + callback for a token minted from `over`. Returns the callback's redirect target. */
async function flow(sessionCookie: string, provider: 'microsoft' | 'google', over: Record<string, unknown> = {}, mintNonce?: (n: string) => string) {
  const f = await start(sessionCookie, provider)
  const code = `code-${++codeSeq}`
  issued.set(code, await mint(provider, mintNonce ? mintNonce(f.nonce) : f.nonce, over))
  const res = await call(app, `/api/auth/campus-idp/callback?code=${code}&state=${encodeURIComponent(f.state)}`, { cookie: f.cookie })
  return { res, f, code, to: res.headers.get('location') ?? '' }
}

const userRow = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } })
const tenantOf = async (shortNamePart: string) => (await prisma.campus.findFirstOrThrow({ where: { shortName: { contains: shortNamePart }, entraTenantIds: { isEmpty: false } } }))

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  privateKey = pair.privateKey
  jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }
  jwksKeys = [jwk]
  jwksServer = createServer((_req, res) => {
    jwksHits++
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ keys: jwksKeys }))
  })
  await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', r))
  jwksUrl = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}/keys`
  idp = createCampusIdp({ microsoft: MS, google: GOOGLE, jwksUrls: { microsoft: jwksUrl, google: jwksUrl }, fetch: fakeFetch })
  app = createApp({ prisma, auth: createAuth({ prisma, baseURL, secret, campusIdp: idp, campusIdpProviders: { microsoft: true, google: true } }), storage, paymentService })
})

afterAll(() => new Promise<void>((r) => jwksServer.close(() => r())))

beforeEach(async () => {
  issued.clear()
  verifiers.clear()
  await resetDb(prisma)
})

afterEach(() => vi.restoreAllMocks())

describe('validateClaims (pure)', () => {
  const ctx = { clientId: MS.clientId, nonce: 'n1', now: new Date(2026, 10, 18) }
  const ms = (over: Record<string, unknown> = {}) => ({ iss: 'https://login.microsoftonline.com/t1/v2.0', aud: MS.clientId, tid: 't1', oid: 'o1', nonce: 'n1', exp: Math.floor(ctx.now.getTime() / 1000) + 600, ...over })
  const g = (over: Record<string, unknown> = {}) => ({ iss: 'accounts.google.com', aud: MS.clientId, sub: 's1', hd: 'Binus.ac.id', nonce: 'n1', exp: Math.floor(ctx.now.getTime() / 1000) + 600, ...over })

  it('accepts good Microsoft and Google claims and returns only the identity fields', () => {
    expect(validateClaims('microsoft', ms(), ctx)).toEqual({ provider: 'microsoft', tid: 't1', oid: 'o1', iss: 'https://login.microsoftonline.com/t1/v2.0' })
    expect(validateClaims('google', g(), ctx)).toEqual({ provider: 'google', sub: 's1', hd: 'binus.ac.id' })
    expect(validateClaims('google', g({ iss: 'https://accounts.google.com' }), ctx).provider).toBe('google')
  })

  it('rejects every broken claim', () => {
    const bad: [string, () => unknown][] = [
      ['ms iss', () => validateClaims('microsoft', ms({ iss: 'https://login.microsoftonline.com/other/v2.0' }), ctx)],
      ['ms v1 iss', () => validateClaims('microsoft', ms({ iss: 'https://sts.windows.net/t1/' }), ctx)],
      ['ms aud', () => validateClaims('microsoft', ms({ aud: 'someone-else' }), ctx)],
      ['ms expired', () => validateClaims('microsoft', ms({ exp: Math.floor(ctx.now.getTime() / 1000) - 1 }), ctx)],
      ['ms no exp', () => validateClaims('microsoft', ms({ exp: undefined }), ctx)],
      ['ms nonce', () => validateClaims('microsoft', ms({ nonce: 'n2' }), ctx)],
      ['ms no tid', () => validateClaims('microsoft', ms({ tid: undefined }), ctx)],
      ['ms no oid', () => validateClaims('microsoft', ms({ oid: undefined }), ctx)],
      ['ms consumer', () => validateClaims('microsoft', ms({ tid: MICROSOFT_CONSUMER_TENANT, iss: `https://login.microsoftonline.com/${MICROSOFT_CONSUMER_TENANT}/v2.0` }), ctx)],
      ['g iss', () => validateClaims('google', g({ iss: 'https://evil.example' }), ctx)],
      ['g no hd', () => validateClaims('google', g({ hd: undefined }), ctx)],
      ['g no sub', () => validateClaims('google', g({ sub: undefined }), ctx)],
      ['g nonce', () => validateClaims('google', g({ nonce: 'x' }), ctx)],
    ]
    for (const [name, fn] of bad) expect(fn, name).toThrow(/campus idp/)
  })

  it('never reads email or preferred_username', () => {
    const trap = (base: Record<string, unknown>) =>
      new Proxy(base, {
        get(t, k) {
          if (k === 'email' || k === 'preferred_username') throw new Error(`read ${String(k)}`)
          return t[k as string]
        },
      })
    expect(() => validateClaims('microsoft', trap(ms({ email: 'a@b', preferred_username: 'a@b' })), ctx)).not.toThrow()
    expect(() => validateClaims('google', trap(g({ email: 'a@b' })), ctx)).not.toThrow()
  })
})

describe('verifyIdToken through the real JWKS path', () => {
  const mk = (over: Record<string, unknown> = {}) => ({ iss: 'https://login.microsoftonline.com/t1/v2.0', aud: MS.clientId, tid: 't1', oid: 'o1', nonce: 'n1', exp: NOW() + 600, ...over })
  const sign = (payload: Record<string, unknown>, key = privateKey, header: Record<string, unknown> = { alg: 'RS256', kid: KID }) => new SignJWT(payload).setProtectedHeader(header as never).sign(key)
  const verify = (i: ReturnType<typeof createCampusIdp>, idToken: string, provider: 'microsoft' | 'google' = 'microsoft') => i.verifyIdToken({ provider, idToken, nonce: 'n1' })
  const fresh = (cooldown = 0) => createCampusIdp({ microsoft: MS, google: GOOGLE, jwksUrls: { microsoft: jwksUrl, google: jwksUrl }, jwksCooldownMs: cooldown })

  it('accepts a valid token and fetches the JWKS over HTTP', async () => {
    const before = jwksHits
    expect(await verify(fresh(), await sign(mk()))).toEqual({ provider: 'microsoft', tid: 't1', oid: 'o1', iss: 'https://login.microsoftonline.com/t1/v2.0' })
    expect(jwksHits).toBeGreaterThan(before)
  })

  it('refetches on an unknown kid, so a rotated key works without waiting out a cache', async () => {
    const i = fresh()
    await verify(i, await sign(mk())) // primes the cache with the old key
    const next = await generateKeyPair('RS256', { extractable: true })
    jwksKeys = [jwk, { ...(await exportJWK(next.publicKey)), kid: 'rotated', alg: 'RS256', use: 'sig' }]
    try {
      expect((await verify(i, await sign(mk(), next.privateKey, { alg: 'RS256', kid: 'rotated' }))).provider).toBe('microsoft')
    } finally {
      jwksKeys = [jwk]
    }
  })

  it('refuses a kid that is still unknown after the refetch', async () => {
    await expect(verify(fresh(), await sign(mk(), privateKey, { alg: 'RS256', kid: 'nope' }))).rejects.toThrow(/campus idp/)
  })

  it('refuses alg none and HS256 (including an HMAC keyed with the public key)', async () => {
    const i = fresh()
    const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    await expect(verify(i, `${b({ alg: 'none', kid: KID })}.${b(mk())}.`)).rejects.toThrow(/campus idp/)
    const hs = await new SignJWT(mk()).setProtectedHeader({ alg: 'HS256', kid: KID }).sign(new TextEncoder().encode(JSON.stringify(jwk)))
    await expect(verify(i, hs)).rejects.toThrow(/campus idp/)
  })

  it('refuses expired, wrong audience, wrong issuer, tid mismatch and wrong google issuer', async () => {
    const i = fresh()
    await expect(verify(i, await sign(mk({ exp: NOW() - 10 })))).rejects.toThrow(/campus idp/)
    await expect(verify(i, await sign(mk({ aud: 'other' })))).rejects.toThrow(/campus idp/)
    await expect(verify(i, await sign(mk({ iss: 'https://evil.example/t1/v2.0' })))).rejects.toThrow(/campus idp: iss/)
    await expect(verify(i, await sign(mk({ tid: 't2' })))).rejects.toThrow(/campus idp: iss/)
    const g = { iss: 'https://evil.example', aud: GOOGLE.clientId, sub: 's', hd: 'binus.ac.id', nonce: 'n1', exp: NOW() + 600 }
    await expect(verify(i, await sign(g), 'google')).rejects.toThrow(/campus idp/)
    expect((await verify(i, await sign({ ...g, iss: 'accounts.google.com' }), 'google')).provider).toBe('google')
  })

  it('refuses malformed tokens', async () => {
    const i = fresh()
    for (const t of ['', 'abc', 'a.b', 'a.b.c', 'a.b.c.d']) await expect(verify(i, t), t).rejects.toThrow(/campus idp/)
  })

  it('maps an unreachable JWKS to a CampusIdpError', async () => {
    const dead = createCampusIdp({ microsoft: MS, jwksUrls: { microsoft: 'http://127.0.0.1:1/keys' } })
    await expect(verify(dead, await sign(mk()))).rejects.toThrow(/campus idp/)
  })
})

describe('authorizationUrl', () => {
  it('builds a PKCE + state + nonce code flow with minimal scopes', async () => {
    const f = await start(await registerAndSignIn('sari@example.com'), 'microsoft')
    expect(f.location.origin + f.location.pathname).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize')
    const q = f.location.searchParams
    expect([q.get('client_id'), q.get('response_type'), q.get('scope'), q.get('code_challenge_method')]).toEqual([MS.clientId, 'code', 'openid', 'S256'])
    expect(q.get('redirect_uri')).toBe(`${baseURL}/api/auth/campus-idp/callback`)
    const setCookie = f.startRes.headers.getSetCookie().join('\n')
    expect(setCookie).toMatch(/kobo_campus_idp=/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)
    expect(setCookie).toMatch(/Path=\/api\/auth\/campus-idp/)

    const g = await start(await registerAndSignIn('budi@example.com'), 'google')
    expect(g.location.origin + g.location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  })
})

describe('campus account callback', () => {
  it('Microsoft success: tid+oid recorded, 365 days, campus mapped by tenant, no Account row', async () => {
    const itb = await tenantOf('ITB')
    const cookie = await registerAndSignIn('sari@example.com')
    const { to, res, f, code } = await flow(cookie, 'microsoft', { tid: itb.entraTenantIds[0], oid: 'oid-sari' })
    expect(to).toContain('campus=verified')
    // PKCE: the verifier sent to the token endpoint hashes to the challenge sent to the IdP.
    expect(createHash('sha256').update(verifiers.get(code)!).digest('base64url')).toBe(f.location.searchParams.get('code_challenge'))
    expect(res.headers.getSetCookie().join('\n')).toMatch(/kobo_campus_idp=;[^]*Max-Age=0/i)

    const u = await userRow('sari@example.com')
    expect([u.campusIdpTenant, u.campusIdpSubject, u.campusVerifiedVia, u.campus]).toEqual([itb.entraTenantIds[0], 'oid-sari', 'MICROSOFT', itb.shortName])
    expect(u.campusEmailVerifiedAt).not.toBeNull()
    const days = (u.campusVerifiedUntil!.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(364)
    expect(await prisma.account.count({ where: { userId: u.id, providerId: { not: 'credential' } } })).toBe(0)
  })

  it('Google success: hd mapped through studentEmailDomains, tenant stored as google:<hd>', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    const { to } = await flow(cookie, 'google', { hd: 'binus.ac.id', sub: 'sub-sari' })
    expect(to).toContain('campus=verified')
    const u = await userRow('sari@example.com')
    expect([u.campusIdpTenant, u.campusIdpSubject, u.campusVerifiedVia]).toEqual(['google:binus.ac.id', 'sub-sari', 'GOOGLE'])
    expect(u.campus).toMatch(/^Binus/)
    expect(await prisma.account.count({ where: { userId: u.id, providerId: { not: 'credential' } } })).toBe(0)
  })

  it('unknown tid and unknown hd are refused and logged with only the tenant', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cookie = await registerAndSignIn('sari@example.com')
    expect((await flow(cookie, 'microsoft', { tid: 'aaaaaaaa-0000-0000-0000-000000000000', oid: 'o9' })).to).toContain('campus=idp-unknown')
    expect(warn).toHaveBeenCalledWith('[campus-idp] unknown', { provider: 'microsoft', tid: 'aaaaaaaa-0000-0000-0000-000000000000' })
    expect((await flow(cookie, 'google', { hd: 'unknown.ac.id' })).to).toContain('campus=idp-unknown')
    expect(warn).toHaveBeenCalledWith('[campus-idp] unknown', { provider: 'google', hd: 'unknown.ac.id' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('someone@elsewhere')
    const u = await userRow('sari@example.com')
    expect([u.campusVerifiedVia, u.campusIdpTenant, u.campusEmailVerifiedAt]).toEqual([null, null, null])
  })

  it('refuses the consumer tenant, wrong iss, wrong aud, expired, bad nonce, bad signature and unknown kid', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const itb = await tenantOf('ITB')
    const tid = itb.entraTenantIds[0]
    const cookie = await registerAndSignIn('sari@example.com')
    const cases: [string, Record<string, unknown>, ((n: string) => string)?][] = [
      ['consumer', { tid: MICROSOFT_CONSUMER_TENANT, iss: `https://login.microsoftonline.com/${MICROSOFT_CONSUMER_TENANT}/v2.0` }],
      ['iss', { tid, iss: 'https://login.microsoftonline.com/other/v2.0' }],
      ['aud', { tid, aud: 'another-app' }],
      ['expired', { tid, exp: NOW() - 10 }],
      ['nonce', { tid }, () => 'not-the-nonce'],
    ]
    for (const [name, over, nonce] of cases) expect((await flow(cookie, 'microsoft', over, nonce)).to, name).toContain('campus=idp-invalid')

    // Tampered signature and an unknown key id.
    const f = await start(cookie, 'microsoft')
    const good = await mint('microsoft', f.nonce, { tid })
    const [h, p, s] = good.split('.')
    issued.set('c-sig', `${h}.${p}.${`${s.slice(0, 5)}${s[5] === 'A' ? 'B' : 'A'}${s.slice(6)}`}`)
    expect((await call(app, `/api/auth/campus-idp/callback?code=c-sig&state=${encodeURIComponent(f.state)}`, { cookie: f.cookie })).headers.get('location')).toContain('idp-invalid')
    const f2 = await start(cookie, 'microsoft')
    issued.set('c-kid', await mint('microsoft', f2.nonce, { tid }, { kid: 'other-key' }))
    expect((await call(app, `/api/auth/campus-idp/callback?code=c-kid&state=${encodeURIComponent(f2.state)}`, { cookie: f2.cookie })).headers.get('location')).toContain('idp-invalid')
    expect((await userRow('sari@example.com')).campusVerifiedVia).toBeNull()
  })

  it('Google without hd (a personal account) and with a foreign hd are refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cookie = await registerAndSignIn('sari@example.com')
    expect((await flow(cookie, 'google', { hd: undefined })).to).toContain('campus=idp-invalid')
    expect((await flow(cookie, 'google', { hd: 'gmail.com' })).to).toContain('campus=idp-unknown')
    expect((await userRow('sari@example.com')).campusVerifiedVia).toBeNull()
  })

  it('ignores the email claim: a token claiming another campus by email still maps by tid', async () => {
    const itb = await tenantOf('ITB')
    const cookie = await registerAndSignIn('sari@example.com')
    const { to } = await flow(cookie, 'microsoft', { tid: itb.entraTenantIds[0], oid: 'o-e', email: 'mhs@binus.ac.id', preferred_username: 'mhs@binus.ac.id' })
    expect(to).toContain('campus=verified')
    expect((await userRow('sari@example.com')).campus).toBe(itb.shortName)
  })

  it('a replayed callback is refused (state is single use, even with the captured cookie)', async () => {
    const itb = await tenantOf('ITB')
    const cookie = await registerAndSignIn('sari@example.com')
    const first = await flow(cookie, 'microsoft', { tid: itb.entraTenantIds[0], oid: 'o-r' })
    expect(first.to).toContain('campus=verified')
    await prisma.user.update({ where: { email: 'sari@example.com' }, data: { campusVerifiedVia: null, campusEmailVerifiedAt: null, campusVerifiedUntil: null, campusIdpTenant: null, campusIdpSubject: null } })
    const again = await call(app, `/api/auth/campus-idp/callback?code=${first.code}&state=${encodeURIComponent(first.f.state)}`, { cookie: first.f.cookie })
    expect(again.headers.get('location')).toContain('campus=idp-invalid')
    // And with the cleared cookie a browser would now send:
    const cleared = await call(app, `/api/auth/campus-idp/callback?code=${first.code}&state=${encodeURIComponent(first.f.state)}`, { cookie })
    expect(cleared.headers.get('location')).toContain('campus=idp-invalid')
    expect((await userRow('sari@example.com')).campusVerifiedVia).toBeNull()
  })

  it('refuses a wrong state, a missing flow cookie, a cancelled login and a signed-out caller', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    const f = await start(cookie, 'google')
    issued.set('c1', await mint('google', f.nonce))
    expect((await call(app, '/api/auth/campus-idp/callback?code=c1&state=wrong', { cookie: f.cookie })).headers.get('location')).toContain('idp-invalid')
    const f2 = await start(cookie, 'google')
    expect((await call(app, `/api/auth/campus-idp/callback?code=c1&state=${f2.state}`, { cookie })).headers.get('location')).toContain('idp-invalid')
    const f3 = await start(cookie, 'google')
    expect((await call(app, `/api/auth/campus-idp/callback?error=access_denied&state=${f3.state}`, { cookie: f3.cookie })).headers.get('location')).toContain('idp-cancelled')
    const f4 = await start(cookie, 'google')
    const flowOnly = cookieFrom(f4.startRes)
    expect((await call(app, `/api/auth/campus-idp/callback?code=c1&state=${f4.state}`, { cookie: flowOnly })).headers.get('location')).toContain('idp-invalid')
    expect((await userRow('sari@example.com')).campusVerifiedVia).toBeNull()
  })

  it('refuses a callback from a different signed-in user than the one who started', async () => {
    const itb = await tenantOf('ITB')
    const a = await registerAndSignIn('a@example.com')
    const b = await registerAndSignIn('b@example.com')
    const f = await start(a, 'microsoft')
    issued.set('cx', await mint('microsoft', f.nonce, { tid: itb.entraTenantIds[0], oid: 'o-a' }))
    const flowCookie = cookieFrom(f.startRes)
    const res = await call(app, `/api/auth/campus-idp/callback?code=cx&state=${encodeURIComponent(f.state)}`, { cookie: `${b}; ${flowCookie}` })
    expect(res.headers.get('location')).toContain('campus=idp-invalid')
    expect((await userRow('a@example.com')).campusVerifiedVia).toBeNull()
    expect((await userRow('b@example.com')).campusVerifiedVia).toBeNull()
  })

  it('a (tenant, subject) already used by another account is refused', async () => {
    const itb = await tenantOf('ITB')
    const a = await registerAndSignIn('a@example.com')
    const b = await registerAndSignIn('b@example.com')
    expect((await flow(a, 'microsoft', { tid: itb.entraTenantIds[0], oid: 'same-oid' })).to).toContain('campus=verified')
    expect((await flow(b, 'microsoft', { tid: itb.entraTenantIds[0], oid: 'same-oid' })).to).toContain('campus=idp-taken')
    expect((await userRow('b@example.com')).campusVerifiedVia).toBeNull()
    // The same user may redo it.
    expect((await flow(a, 'microsoft', { tid: itb.entraTenantIds[0], oid: 'same-oid' })).to).toContain('campus=verified')
  })
})

describe('campus-idp start', () => {
  it('requires a session and is blocked for demo accounts', async () => {
    expect((await call(app, '/api/auth/campus-idp/start?provider=google')).status).toBe(401)
    const res = await call(app, '/api/auth/campus-idp/start?provider=google', { cookie: await demoCookie('student') })
    expect(res.status).toBe(403)
  })

  it('refuses a provider that is not configured and sets no flow cookie', async () => {
    const onlyGoogle = createApp({ prisma, auth: createAuth({ prisma, baseURL, secret, campusIdp: idp, campusIdpProviders: { microsoft: false, google: true } }), storage, paymentService })
    const cookie = await registerAndSignIn('sari@example.com')
    const res = await call(onlyGoogle, '/api/auth/campus-idp/start?provider=microsoft', { cookie })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('campus=idp-unavailable')
    expect(res.headers.getSetCookie().join('')).not.toContain('kobo_campus_idp')
    expect((await call(onlyGoogle, '/api/auth/campus-idp/start?provider=google', { cookie })).headers.get('location')).toContain('accounts.google.com')
    // The real idp itself also refuses a provider with no credentials.
    const bare = createCampusIdp({ google: GOOGLE })
    await expect(bare.authorizationUrl({ provider: 'microsoft', state: 's', nonce: 'n', codeVerifier: 'v', redirectUri: 'r' })).rejects.toThrow(/not configured/)
  })

  it('exposes which providers are available on the auth object, without credentials', () => {
    expect(createAuth({ prisma, baseURL, secret }).campusIdpProviders).toEqual({ microsoft: false, google: false })
    expect(createAuth({ prisma, baseURL, secret, google: GOOGLE, campusMs: MS }).campusIdpProviders).toEqual({ microsoft: true, google: true })
  })

  it('is rate-limited: start and callback allow 10 per minute per client', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    const ip = nextIp()
    const starts: number[] = []
    for (let i = 0; i < 11; i++) starts.push((await call(app, '/api/auth/campus-idp/start?provider=google', { cookie, ip })).status)
    expect(starts.slice(0, 10).every((s) => s === 302)).toBe(true)
    expect(starts[10]).toBe(429)

    const ip2 = nextIp()
    const cbs: number[] = []
    for (let i = 0; i < 11; i++) cbs.push((await call(app, '/api/auth/campus-idp/callback?code=x&state=y', { cookie, ip: ip2 })).status)
    expect(cbs.slice(0, 10).every((s) => s === 302)).toBe(true)
    expect(cbs[10]).toBe(429)
  })
})
