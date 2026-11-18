import { createHmac } from 'node:crypto'
import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.ts'
import { resetDb } from '../../src/db/seed.ts'
import {
  HttpSheerIdClient,
  outcomeOf,
  settleSheerId,
  SHEERID_CONSENT_VERSION,
  sheerIdEnv,
  verifySheerIdSignature,
  type SheerIdClient,
  type SheerIdService,
  type SheerIdVerificationState,
} from '../../src/sheerid.ts'
import { auth, callerFor, DEMO_STUDENT_ID, newStudent, paymentService, prisma, storage } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const code = async (p: Promise<unknown>) => (await err(p))?.code

/** Network-free SheerID: tests set the step each verification reports. */
class FakeSheerId implements SheerIdClient {
  steps = new Map<string, SheerIdVerificationState>()
  purged: string[] = []
  created = 0
  failCreate = false
  failPurge = false
  async createVerification() {
    if (this.failCreate) throw new Error('down')
    const verificationId = `v${(++this.created).toString().padStart(24, '0')}`
    this.steps.set(verificationId, { currentStep: 'collectStudentPersonalInfo', errorIds: [] })
    return { verificationId }
  }
  async getVerification(id: string) {
    return this.steps.get(id) ?? { currentStep: 'error', errorIds: ['notFound'] }
  }
  async purgePersonData(id: string) {
    if (this.failPurge) throw new Error('down')
    this.purged.push(id)
  }
  formUrl(id: string) {
    return `https://services.sheerid.com/verify/prog-test/?verificationId=${id}`
  }
}

const SECRET = 'whsec-test'
const setup = (webhookSecret: string | null = SECRET) => {
  const fake = new FakeSheerId()
  const service: SheerIdService = { client: fake, webhookSecret }
  return { fake, service }
}
const campusId = async () => (await prisma.campus.findFirstOrThrow({ orderBy: { id: 'asc' } })).id

describe('sheerIdEnv (dev/test only fence)', () => {
  const full = { SHEERID_ENABLED: '1', SHEERID_PROGRAM_ID: 'p', SHEERID_CLIENT_ID: 'c', SHEERID_CLIENT_SECRET: 's' }
  it('is off unless SHEERID_ENABLED=1', () => {
    expect(sheerIdEnv({})).toBeNull()
    expect(sheerIdEnv({ ...full, SHEERID_ENABLED: 'true' })).toBeNull()
  })
  it('refuses to start in production, whatever else is set', () => {
    expect(() => sheerIdEnv({ ...full, NODE_ENV: 'production' })).toThrow(/refused in production/)
  })
  it('refuses a half configuration and names what is missing', () => {
    expect(() => sheerIdEnv({ SHEERID_ENABLED: '1', SHEERID_PROGRAM_ID: 'p' })).toThrow(/SHEERID_CLIENT_ID, SHEERID_CLIENT_SECRET/)
  })
  it('returns the config; the webhook secret is optional', () => {
    expect(sheerIdEnv({ ...full, NODE_ENV: 'development' })).toEqual({ programId: 'p', clientId: 'c', clientSecret: 's', webhookSecret: null })
    expect(sheerIdEnv({ ...full, SHEERID_WEBHOOK_SECRET: 'w' })?.webhookSecret).toBe('w')
  })
})

describe('HttpSheerIdClient', () => {
  it('caches the OAuth token, sends only the programId, and builds the hosted form URL', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url.startsWith('https://auth.sheerid.com/')) return Response.json({ access_token: 'tok', expires_in: 2_592_000 })
      if (url.endsWith('/verification')) return Response.json({ verificationId: 'abc123', currentStep: 'collectStudentPersonalInfo' })
      if (url.endsWith('/purgePersonData')) return new Response('', { status: 200 })
      return Response.json({ currentStep: 'success', errorIds: [] })
    }) as typeof fetch
    const c = new HttpSheerIdClient({ programId: 'prog', clientId: 'id', clientSecret: 'sec', webhookSecret: null }, fetchFn)
    expect(await c.createVerification()).toEqual({ verificationId: 'abc123' })
    expect(await c.getVerification('abc123')).toEqual({ currentStep: 'success', errorIds: [] })
    await c.purgePersonData('abc123')
    expect(calls.filter((x) => x.url.startsWith('https://auth.sheerid.com/'))).toHaveLength(1)
    const create = calls.find((x) => x.url.endsWith('/verification'))!
    expect(JSON.parse(String(create.init.body))).toEqual({ programId: 'prog' })
    expect((create.init.headers as Record<string, string>).authorization).toBe('Bearer tok')
    expect(calls.some((x) => x.url === 'https://services.sheerid.com/rest/v2/verification/abc123/purgePersonData' && x.init.method === 'POST')).toBe(true)
    expect(c.formUrl('abc123')).toBe('https://services.sheerid.com/verify/prog/?verificationId=abc123')
  })
  it('throws on a non-2xx answer', async () => {
    const fetchFn = (async (url: string) => (url.startsWith('https://auth') ? Response.json({ access_token: 't' }) : new Response('no', { status: 500 }))) as typeof fetch
    const c = new HttpSheerIdClient({ programId: 'p', clientId: 'i', clientSecret: 's', webhookSecret: null }, fetchFn)
    await expect(c.createVerification()).rejects.toThrow(/500/)
  })
})

describe('verifySheerIdSignature / outcomeOf', () => {
  it('accepts only the lowercase-hex HMAC-SHA256 of the raw body', () => {
    const body = '{"verificationId":"v1","notifierEventType":"SUCCESS"}'
    const sig = createHmac('sha256', SECRET).update(body).digest('hex')
    expect(verifySheerIdSignature(body, sig, SECRET)).toBe(true)
    expect(verifySheerIdSignature(body, sig.toUpperCase(), SECRET)).toBe(true)
    expect(verifySheerIdSignature(body + ' ', sig, SECRET)).toBe(false)
    expect(verifySheerIdSignature(body, sig, 'other')).toBe(false)
    expect(verifySheerIdSignature(body, undefined, SECRET)).toBe(false)
    expect(verifySheerIdSignature(body, 'short', SECRET)).toBe(false)
  })
  it('maps steps to outcomes', () => {
    expect(outcomeOf('success')).toBe('SUCCESS')
    expect(outcomeOf('error')).toBe('FAILED')
    expect(outcomeOf('docUpload')).toBe('PENDING')
    expect(outcomeOf('pending')).toBe('PENDING')
  })
})

describe('studentVerification.sheeridStart', () => {
  it('is NOT_FOUND when SheerID is off', async () => {
    const s = await newStudent()
    expect(await code(callerFor(s.id).studentVerification.sheeridStart({ campusId: await campusId(), consent: true }))).toBe('NOT_FOUND')
  })
  it('refuses demo accounts, verified students, a missing consent and an unknown campus', async () => {
    const { service } = setup()
    expect(await code(callerFor(DEMO_STUDENT_ID, { isDemo: true, sheerid: service }).studentVerification.sheeridStart({ campusId: await campusId(), consent: true }))).toBe('FORBIDDEN')
    const verified = await newStudent()
    await prisma.user.update({ where: { id: verified.id }, data: { campusEmailVerifiedAt: new Date(), campusVerifiedVia: 'EMAIL', campusVerifiedUntil: new Date(Date.now() + 86_400_000) } })
    expect(await code(callerFor(verified.id, { sheerid: service }).studentVerification.sheeridStart({ campusId: await campusId(), consent: true }))).toBe('PRECONDITION_FAILED')
    const s = await newStudent()
    expect(await code(callerFor(s.id, { sheerid: service }).studentVerification.sheeridStart({ campusId: await campusId(), consent: false as never }))).toBe('BAD_REQUEST')
    expect(await code(callerFor(s.id, { sheerid: service }).studentVerification.sheeridStart({ campusId: 'nope', consent: true }))).toBe('BAD_REQUEST')
    expect(await prisma.sheerIdVerification.count()).toBe(0)
  })
  it('records the consent and returns the hosted form, storing no personal data', async () => {
    const { fake, service } = setup()
    const s = await newStudent()
    const cid = await campusId()
    const res = await callerFor(s.id, { sheerid: service }).studentVerification.sheeridStart({ campusId: cid, consent: true })
    const row = await prisma.sheerIdVerification.findFirstOrThrow({ where: { userId: s.id } })
    expect(res.url).toBe(fake.formUrl(row.verificationId))
    expect(row).toMatchObject({ status: 'PENDING', campusId: cid, consentVersion: SHEERID_CONSENT_VERSION, purgedAt: null })
    expect(row.consentAt).toBeInstanceOf(Date)
  })
  it('is BAD_GATEWAY when SheerID is down, and writes nothing', async () => {
    const { fake, service } = setup()
    fake.failCreate = true
    const s = await newStudent()
    expect(await code(callerFor(s.id, { sheerid: service }).studentVerification.sheeridStart({ campusId: await campusId(), consent: true }))).toBe('BAD_GATEWAY')
    expect(await prisma.sheerIdVerification.count()).toBe(0)
  })
})

async function started() {
  const { fake, service } = setup()
  const s = await newStudent()
  await callerFor(s.id, { sheerid: service }).studentVerification.sheeridStart({ campusId: await campusId(), consent: true })
  const row = await prisma.sheerIdVerification.findFirstOrThrow({ where: { userId: s.id } })
  return { fake, service, s, row, c: callerFor(s.id, { sheerid: service }) }
}

describe('studentVerification.sheeridRefresh / settleSheerId', () => {
  it('keeps an unfinished verification PENDING and does not verify', async () => {
    const { fake, row, c, s } = await started()
    fake.steps.set(row.verificationId, { currentStep: 'docUpload', errorIds: [] })
    const st = await c.studentVerification.sheeridRefresh()
    expect(st.state).toBe('NONE')
    expect(st.providers.sheerid).toBe(true)
    expect((await prisma.sheerIdVerification.findUniqueOrThrow({ where: { id: row.id } })).lastStep).toBe('docUpload')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).campusEmailVerifiedAt).toBeNull()
    expect(fake.purged).toEqual([])
  })
  it('on success verifies via SHEERID for at most 12 months, then purges the person at SheerID', async () => {
    const { fake, row, c, s } = await started()
    fake.steps.set(row.verificationId, { currentStep: 'success', errorIds: [] })
    const st = await c.studentVerification.sheeridRefresh()
    expect(st).toMatchObject({ state: 'VERIFIED', via: 'SHEERID' })
    const u = await prisma.user.findUniqueOrThrow({ where: { id: s.id } })
    expect(u.campusVerifiedVia).toBe('SHEERID')
    expect(u.campusVerifiedUntil!.getTime() - Date.now()).toBeLessThanOrEqual(365 * 86_400_000 + 5_000)
    const after = await prisma.sheerIdVerification.findUniqueOrThrow({ where: { id: row.id } })
    expect(after.status).toBe('SUCCESS')
    expect(after.purgedAt).not.toBeNull()
    expect(fake.purged).toEqual([row.verificationId])
  })
  it('on error records FAILED with the error ids, does not verify, and still purges', async () => {
    const { fake, row, c, s } = await started()
    fake.steps.set(row.verificationId, { currentStep: 'error', errorIds: ['docReviewLimitExceeded'] })
    await c.studentVerification.sheeridRefresh()
    const after = await prisma.sheerIdVerification.findUniqueOrThrow({ where: { id: row.id } })
    expect(after).toMatchObject({ status: 'FAILED', errorIds: ['docReviewLimitExceeded'] })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).campusEmailVerifiedAt).toBeNull()
    expect(fake.purged).toEqual([row.verificationId])
  })
  it('applies a result once even when the webhook and the refresh race, and retries a failed purge later', async () => {
    const { fake, row } = await started()
    fake.steps.set(row.verificationId, { currentStep: 'success', errorIds: [] })
    fake.failPurge = true
    const results = await Promise.all([settleSheerId(prisma, fake, row.verificationId), settleSheerId(prisma, fake, row.verificationId)])
    expect(results).toEqual(['SUCCESS', 'SUCCESS'])
    expect((await prisma.sheerIdVerification.findUniqueOrThrow({ where: { id: row.id } })).purgedAt).toBeNull()
    fake.failPurge = false
    expect(await settleSheerId(prisma, fake, row.verificationId)).toBe('SUCCESS')
    expect(fake.purged).toEqual([row.verificationId])
    expect((await prisma.sheerIdVerification.findUniqueOrThrow({ where: { id: row.id } })).purgedAt).not.toBeNull()
  })
  it('ignores an unknown verificationId', async () => {
    const { fake } = setup()
    expect(await settleSheerId(prisma, fake, 'unknown')).toBe('UNKNOWN')
  })
})

describe('POST /api/webhooks/sheerid', () => {
  const post = (app: ReturnType<typeof createApp>, body: string, sig?: string) =>
    app.request('/api/webhooks/sheerid', { method: 'POST', body, headers: { 'content-type': 'application/json', ...(sig ? { 'x-sheerid-signature': sig } : {}) } })
  const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex')

  it('is 404 when SheerID or its webhook secret is not configured', async () => {
    expect((await post(createApp({ prisma, auth, storage, paymentService, sheerid: null }), '{}')).status).toBe(404)
    expect((await post(createApp({ prisma, auth, storage, paymentService, sheerid: setup(null).service }), '{}')).status).toBe(404)
  })
  it('rejects a bad signature and a malformed body', async () => {
    const app = createApp({ prisma, auth, storage, paymentService, sheerid: setup().service })
    expect((await post(app, '{"verificationId":"v1"}', 'bad')).status).toBe(401)
    expect((await post(app, '{"verificationId":"v1"}')).status).toBe(401)
    expect((await post(app, 'not json', sign('not json'))).status).toBe(400)
    expect((await post(app, '{"verificationId":5}', sign('{"verificationId":5}'))).status).toBe(400)
  })
  it('re-reads SheerID and verifies the student on a signed callback', async () => {
    const { fake, service, row, s } = await started()
    const app = createApp({ prisma, auth, storage, paymentService, sheerid: service })
    fake.steps.set(row.verificationId, { currentStep: 'success', errorIds: [] })
    const body = JSON.stringify({ verificationId: row.verificationId, notifierEventType: 'SUCCESS' })
    const res = await post(app, body, sign(body))
    expect(res.status).toBe(200)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).campusVerifiedVia).toBe('SHEERID')
    expect((await post(app, body, sign(body))).status).toBe(200) // retries are harmless
  })
})
