import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { DAY, HOUR, RateLimiter } from '../../src/rateLimit.ts'
import { callerFor, newStudent, prisma } from '../helpers.ts'
import { err, kosInput, newOwner, roomInput } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

/** A limiter that is on (the shared one is off under vitest) with a clock the test moves. */
function clocked() {
  const clock = { t: 1_800_000_000_000 }
  return { clock, limiter: new RateLimiter({ enabled: true, now: () => clock.t }) }
}

const isLimited = async (p: Promise<unknown>) => (await err(p))?.code === 'TOO_MANY_REQUESTS'

/** Calls `fn` `n` times (none may be rate limited), then once more (must be, with `message`). */
async function expectLimit(fn: () => Promise<unknown>, n: number, message: string) {
  for (let i = 0; i < n; i++) expect(await isLimited(fn()), `call ${i + 1} of ${n}`).toBe(false)
  const e = await err(fn())
  expect(e?.code).toBe('TOO_MANY_REQUESTS')
  expect(e?.message).toBe(message)
}

const placeInput = (kosId: string, i: number) => ({ kosId, name: `Tempat ${i}`, category: 'food' as const, lat: -6.2005, lng: 106.7855 })

describe('[G-056][R-068] owner-side limits', () => {
  it('kos.create: 5 per day per owner, a second owner is unaffected, the window slides', async () => {
    const { limiter, clock } = clocked()
    const a = await newOwner()
    const b = await newOwner()
    const ca = callerFor(a.userId, { limiter })
    await expectLimit(() => ca.owner.kos.create(kosInput() as never), 5, 'Terlalu banyak kos didaftarkan hari ini. Coba lagi besok.')
    expect(await isLimited(callerFor(b.userId, { limiter }).owner.kos.create(kosInput() as never))).toBe(false)
    clock.t += DAY + 1
    expect(await isLimited(ca.owner.kos.create(kosInput() as never))).toBe(false)
  })

  it('kos.create: demo owners are exempt from the daily limit', async () => {
    const { limiter } = clocked()
    const d = await newOwner()
    await prisma.user.update({ where: { id: d.userId }, data: { isDemo: true } })
    const c = callerFor(d.userId, { limiter, isDemo: true })
    for (let i = 0; i < 7; i++) expect(await err(c.owner.kos.create(kosInput() as never))).toBeNull()
  })

  it('room.create: 60 per hour per owner, a second owner is unaffected, the window slides', async () => {
    const { limiter, clock } = clocked()
    const a = await newOwner()
    const b = await newOwner()
    const kosA = await a.c.owner.kos.create(kosInput() as never)
    const kosB = await b.c.owner.kos.create(kosInput() as never)
    const ca = callerFor(a.userId, { limiter })
    // The 40-room cap refuses most of these (CONFLICT); the limiter still counts every attempt.
    await expectLimit(() => ca.owner.room.create({ ...roomInput({ roomNumber: `R${Math.random()}`.slice(0, 8) }), kosId: kosA.id } as never), 60, 'Terlalu banyak kamar ditambahkan. Coba lagi dalam satu jam.')
    expect(await isLimited(callerFor(b.userId, { limiter }).owner.room.create({ ...roomInput({ roomNumber: 'B1' }), kosId: kosB.id } as never))).toBe(false)
    clock.t += HOUR + 1
    expect(await isLimited(ca.owner.room.create({ ...roomInput({ roomNumber: 'Z1' }), kosId: kosA.id } as never))).toBe(false)
  })

  it('image presign: 60 per hour per owner', async () => {
    const { limiter, clock } = clocked()
    const a = await newOwner()
    const kos = await a.c.owner.kos.create(kosInput() as never)
    const c = callerFor(a.userId, { limiter })
    const presign = () => c.owner.image.presign({ kosId: kos.id, contentType: 'image/webp', contentLength: 1000, width: 800 })
    await expectLimit(presign, 60, 'Terlalu banyak unggahan foto. Coba lagi dalam satu jam.')
    clock.t += HOUR + 1
    expect(await isLimited(presign())).toBe(false)
  })

  it('owner place add: 30 per day per owner', async () => {
    const { limiter, clock } = clocked()
    const a = await newOwner()
    const kos = await a.c.owner.kos.create(kosInput() as never)
    const c = callerFor(a.userId, { limiter })
    // The 30-places-per-kos cap is checked before the limiter, so calls 1..30 succeed and the 31st would hit the cap first:
    // fill the limiter's bucket with the 30 real calls, then the 31st reaches the cap (CONFLICT), proving the cap order.
    for (let i = 0; i < 30; i++) expect(await err(c.owner.places.add(placeInput(kos.id, i) as never))).toBeNull()
    expect((await err(c.owner.places.add(placeInput(kos.id, 31) as never)))?.code).toBe('CONFLICT')
    // After the cap is cleared the bucket still holds 30 hits, so the next add is the 31st of the day.
    await prisma.ownerPlace.deleteMany({ where: { kosId: kos.id } })
    expect((await err(c.owner.places.add(placeInput(kos.id, 32) as never)))?.message).toBe('Terlalu banyak tempat ditambahkan hari ini. Coba lagi besok.')
    clock.t += DAY + 1
    expect(await err(c.owner.places.add(placeInput(kos.id, 33) as never))).toBeNull()
  })

  it('places refresh: 5 per day per kos, another kos is unaffected', async () => {
    const { limiter, clock } = clocked()
    const a = await newOwner()
    const k1 = await a.c.owner.kos.create(kosInput() as never)
    const k2 = await a.c.owner.kos.create(kosInput({ name: 'Kos Dua' }) as never)
    const c = callerFor(a.userId, { limiter })
    await expectLimit(() => c.owner.places.refresh({ kosId: k1.id }), 5, 'Pembaruan sekitar kos dibatasi 5 kali per hari.')
    expect(await isLimited(c.owner.places.refresh({ kosId: k2.id }))).toBe(false)
    clock.t += DAY + 1
    expect(await isLimited(c.owner.places.refresh({ kosId: k1.id }))).toBe(false)
  })
})

describe('[G-056][R-068] signed-in limits', () => {
  it('becomeOwner: 3 per hour (the bucket is only reached by a user who is not yet an owner)', async () => {
    const { limiter } = clocked()
    const s = await newStudent()
    for (let i = 0; i < 3; i++) limiter.check(`become-owner:${s.id}`, 3, HOUR)
    const e = await err(callerFor(s.id, { limiter }).owner.becomeOwner({ phone: '0812 3456 7890' }))
    expect(e?.code).toBe('TOO_MANY_REQUESTS')
    expect(e?.message).toBe('Terlalu banyak percobaan mendaftar sebagai pemilik. Coba lagi dalam satu jam.')
  })

  it('address lookup: 20 per minute per user, another user is unaffected, the window slides', async () => {
    const { limiter, clock } = clocked()
    const a = await newStudent()
    const b = await newStudent()
    const lookup = () => callerFor(a.id, { limiter }).place.resolveAddress({ q: 'Jl. Uji No. 1 Jakarta' })
    await expectLimit(lookup, 20, 'Terlalu banyak pencarian alamat. Tunggu sebentar lalu coba lagi.')
    expect(await isLimited(callerFor(b.id, { limiter }).place.resolveAddress({ q: 'Jl. Uji No. 1 Jakarta' }))).toBe(false)
    clock.t += 60_001
    expect(await isLimited(lookup())).toBe(false)
  })

  it('reverse lookup: 20 per minute per user', async () => {
    const { limiter } = clocked()
    const a = await newStudent()
    const reverse = () => callerFor(a.id, { limiter }).place.reverse({ lat: -6.2, lng: 106.78 })
    await expectLimit(reverse, 20, 'Terlalu banyak pencarian titik. Tunggu sebentar lalu coba lagi.')
  })
})
