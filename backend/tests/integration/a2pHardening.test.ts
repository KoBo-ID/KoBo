import { IMAGE_MAX_PER_KOS } from '@kobo/shared/schemas'
import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { GeocoderUnavailable, NominatimGeocoder } from '../../src/geocode.ts'
import { fingerprint } from '../../src/payment/webhook.ts'
import { RateLimiter } from '../../src/rateLimit.ts'
import { createCallerFactory } from '../../src/trpc/trpc.ts'
import { appRouter } from '../../src/trpc/router.ts'
import { auth, callerFor, paymentService, prisma, storage } from '../helpers.ts'
import { createFakeStorage } from '../../src/storage.ts'

beforeEach(() => resetDb(prisma))

const SERPONG = { lat: '-6.3', lon: '106.67', display_name: 'Serpong, Tangerang Selatan, Banten, Indonesia' }

describe('B-02 place.search per-IP limit', () => {
  const anon = (ip: string, limiter: RateLimiter) =>
    createCallerFactory(appRouter)({
      prisma, auth, storage: createFakeStorage(), paymentService,
      geocoder: { search: async () => null, resolveAddress: async () => null },
      limiter, headers: new Headers({ 'cf-connecting-ip': ip }), resHeaders: new Headers(), getSession: async () => null,
    })

  it('refuses the 31st search in a minute from one IP with an Indonesian message, other IPs unaffected', async () => {
    const limiter = new RateLimiter({ enabled: true })
    const a = anon('203.0.113.7', limiter)
    for (let i = 0; i < 30; i++) await a.place.search({ q: `serpong ${i}` })
    await expect(a.place.search({ q: 'serpong' })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: expect.stringContaining('Terlalu banyak pencarian lokasi') } satisfies Partial<TRPCError>)
    await expect(anon('203.0.113.8', limiter).place.search({ q: 'serpong' })).resolves.toBeNull()
  })

  it('public search floods fill only their own queue lane, so the owner address lookup still gets a slot', async () => {
    const release: (() => void)[] = []
    const fetchImpl = (async () => {
      await new Promise<void>((r) => release.push(r))
      return new Response(JSON.stringify([SERPONG]), { status: 200 })
    }) as unknown as typeof fetch
    const g = new NominatimGeocoder({ userAgent: 'KoBo/test', fetchImpl, minIntervalMs: 0, sleep: async () => undefined })
    const flood = Array.from({ length: 6 }, (_, i) => g.search(`flood ${i}`).then(() => 'ok', (e: unknown) => (e instanceof GeocoderUnavailable ? 'full' : 'err')))
    const owner = g.resolveAddress('Jl. Contoh No. 1 Serpong').then(() => 'ok', () => 'full')
    await new Promise((r) => setTimeout(r, 20))
    for (let i = 0; i < 20; i++) {
      release.splice(0).forEach((r) => r())
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(await owner).toBe('ok')
    const outcomes = await Promise.all(flood)
    expect(outcomes.filter((o) => o === 'full').length).toBeGreaterThanOrEqual(4)
  })
})

describe('B-13 webhook fingerprint', () => {
  it('differs when status, amount or payment ids differ for the same event, resource and timestamp', () => {
    const base = fingerprint('payment_session.completed', 'ps_1', '2026-10-14T03:00:00.000Z', { status: 'COMPLETED', amount: 1000, paymentRequestId: 'pr_1', paymentId: 'py_1' })
    expect(fingerprint('payment_session.completed', 'ps_1', '2026-10-14T03:00:00.000Z', { status: 'COMPLETED', amount: 1000, paymentRequestId: 'pr_1', paymentId: 'py_1' })).toBe(base)
    expect(fingerprint('payment_session.completed', 'ps_1', '2026-10-14T03:00:00.000Z', { status: 'COMPLETED', amount: 2000, paymentRequestId: 'pr_1', paymentId: 'py_1' })).not.toBe(base)
    expect(fingerprint('payment_session.completed', 'ps_1', '2026-10-14T03:00:00.000Z', { status: 'COMPLETED', amount: 1000, paymentRequestId: 'pr_1', paymentId: 'py_2' })).not.toBe(base)
    expect(fingerprint('payment_session.completed', 'ps_1', '2026-10-14T03:00:00.000Z', { status: 'PENDING', amount: 1000, paymentRequestId: 'pr_1', paymentId: 'py_1' })).not.toBe(base)
  })
})

describe('B-13 owner.image.confirm quota race', () => {
  it('parallel confirms never exceed IMAGE_MAX_PER_KOS', async () => {
    const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: {} } }, include: { kos: { orderBy: { createdAt: 'asc' } } }, orderBy: { id: 'asc' } })
    const kosId = owner.kos[0]!.id
    await prisma.kosImage.deleteMany({ where: { kosId } })
    const c = callerFor(owner.userId)
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 5, 6, 7, 8])
    const total = IMAGE_MAX_PER_KOS + 4
    const keys: string[] = []
    for (let i = 0; i < total; i++) {
      const p = await c.owner.image.presign({ kosId, contentType: 'image/webp', contentLength: bytes.byteLength, width: 800 })
      storage.put(p.key, bytes, 'image/webp')
      keys.push(p.key)
    }
    const results = await Promise.allSettled(keys.map((key, order) => c.owner.image.confirm({ kosId, key, order, width: 800, height: 600 })))
    expect(await prisma.kosImage.count({ where: { kosId } })).toBe(IMAGE_MAX_PER_KOS)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(IMAGE_MAX_PER_KOS)
  })

  it('reorder applies the whole order in one statement and ignores nothing', async () => {
    const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: {} } }, include: { kos: { orderBy: { createdAt: 'asc' } } }, orderBy: { id: 'asc' } })
    const kosId = owner.kos[0]!.id
    await prisma.kosImage.deleteMany({ where: { kosId } })
    const rows = await Promise.all([0, 1, 2].map((order) => prisma.kosImage.create({ data: { kosId, url: `https://x.test/${order}.jpg`, order }, select: { id: true } })))
    const wanted = [rows[2]!.id, rows[0]!.id, rows[1]!.id]
    await callerFor(owner.userId).owner.image.reorder({ kosId, imageIds: wanted })
    const after = await prisma.kosImage.findMany({ where: { kosId }, orderBy: { order: 'asc' }, select: { id: true } })
    expect(after.map((r) => r.id)).toEqual(wanted)
  })
})
