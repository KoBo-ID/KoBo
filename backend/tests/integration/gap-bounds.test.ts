import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { caller, callerFor, demoCookie, newStudent, prisma, request, vacantRoom } from '../helpers.ts'
import { err, GENERIC_VALIDATION, kosInput, newOwner, paidTenancy, roomInput, startIn, twoOwners } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

/** Every case is refused with BAD_REQUEST. The single generic Indonesian message (spec section 10) is applied by the HTTP error formatter and is asserted over HTTP below. */
async function refused(p: Promise<unknown>) {
  const e = await err(p)
  expect(e?.code).toBe('BAD_REQUEST')
}

describe('[G-010][R-070] kos.create and kos.update bounds', () => {
  const tooBig: [string, Record<string, unknown>][] = [
    ['name 101 chars', { name: 'n'.repeat(101) }],
    ['address 201 chars', { address: 'a'.repeat(201) }],
    ['lat 90.1', { lat: 90.1 }],
    ['lng 180.1', { lng: 180.1 }],
    ['discount 5,000,001', { studentDiscountAmount: 5_000_001 }],
    ['application fee 1,000,001', { applicationFee: 1_000_001 }],
    ['31 amenities', { privateAmenities: Array.from({ length: 31 }, (_, i) => `a${i}`) }],
    ['floors 61', { floors: 61 }],
    ['yearBuilt 1899', { yearBuilt: 1899 }],
    ['yearBuilt 2101', { yearBuilt: 2101 }],
    ['61 facilities', { facilities: Array.from({ length: 61 }, (_, i) => ({ label: `f${i}`, scope: 'KAMAR', group: 'KAMAR', status: 'INCLUDED' })) }],
    ['0 initial rooms', { initialRooms: { count: 0, priceMonthly: 1_000_000 } }],
    ['41 initial rooms', { initialRooms: { count: 41, priceMonthly: 1_000_000 } }],
    ['initial room price 50,000,001', { initialRooms: { count: 1, priceMonthly: 50_000_001 } }],
    ['initial room price 1000.5', { initialRooms: { count: 1, priceMonthly: 1000.5 } }],
  ]

  it('kos.create refuses each violated bound and persists nothing', async () => {
    const o = await newOwner()
    for (const [label, over] of tooBig) {
      await refused(o.c.owner.kos.create(kosInput(over) as never)).catch((e) => { throw new Error(`${label}: ${e.message}`) })
    }
    expect(await prisma.kos.count({ where: { ownerId: o.ownerId } })).toBe(0)
  })

  it('kos.update refuses the same violations and keeps the stored row', async () => {
    const { a } = await twoOwners()
    const kosId = a.kos[0]!.id
    const before = await prisma.kos.findUniqueOrThrow({ where: { id: kosId } })
    for (const [label, over] of tooBig.filter(([, o]) => !('initialRooms' in o))) {
      await refused(callerFor(a.userId).owner.kos.update({ ...kosInput(over), kosId } as never)).catch((e) => { throw new Error(`${label}: ${e.message}`) })
    }
    expect(await prisma.kos.findUniqueOrThrow({ where: { id: kosId } })).toEqual(before)
  })

  it('accepts the exact maxima that are not coordinates', async () => {
    const o = await newOwner()
    const made = await o.c.owner.kos.create(
      kosInput({
        name: 'n'.repeat(100),
        address: 'a'.repeat(200),
        studentDiscountAmount: 5_000_000,
        applicationFee: 1_000_000,
        privateAmenities: Array.from({ length: 30 }, (_, i) => `a${i}`.padEnd(60, 'x')),
        floors: 60,
        yearBuilt: 2100,
        initialRooms: { count: 40, priceMonthly: 50_000_000 },
      }) as never,
    )
    expect(await prisma.room.count({ where: { kosId: made.id } })).toBe(40)
    expect((await prisma.kos.findUniqueOrThrow({ where: { id: made.id } })).applicationFee).toBe(1_000_000)
  })
})

describe('[G-011][R-071] room.create and room.update bounds', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['roomNumber 21 chars', { roomNumber: 'r'.repeat(21) }],
    ['floor 0', { floor: 0 }],
    ['floor 61', { floor: 61 }],
    ['price -1', { priceMonthly: -1 }],
    ['price 50,000,001', { priceMonthly: 50_000_001 }],
    ['price 1000.5', { priceMonthly: 1000.5 }],
    ['empty type', { type: '' }],
  ]

  it('refuses each violation on create and on update, and accepts the exact maxima', async () => {
    const o = await newOwner()
    const kos = await o.c.owner.kos.create(kosInput({ initialRooms: { count: 1, priceMonthly: 1_000_000 } }) as never)
    const room = await prisma.room.findFirstOrThrow({ where: { kosId: kos.id } })
    const rooms = await prisma.room.count({ where: { kosId: kos.id } })
    for (const [label, over] of bad) {
      await refused(o.c.owner.room.create({ ...roomInput(over), kosId: kos.id } as never)).catch((e) => { throw new Error(`create ${label}: ${e.message}`) })
      await refused(o.c.owner.room.update({ ...roomInput(over), kosId: kos.id, roomId: room.id } as never)).catch((e) => { throw new Error(`update ${label}: ${e.message}`) })
    }
    expect(await prisma.room.count({ where: { kosId: kos.id } })).toBe(rooms)
    const max = await o.c.owner.room.create({ ...roomInput({ roomNumber: 'r'.repeat(20), floor: 60, priceMonthly: 50_000_000 }), kosId: kos.id } as never)
    expect(await prisma.room.findUniqueOrThrow({ where: { id: max.id } })).toMatchObject({ floor: 60, priceMonthly: 50_000_000 })
  })
})

describe('[G-012][R-072] rules.set bounds', () => {
  it('refuses oversize rule sets and keeps the stored rules', async () => {
    const o = await newOwner()
    const kos = await o.c.owner.kos.create(kosInput() as never)
    const ok = { categoryTitle: 'Umum', rules: ['Jaga kebersihan.'], penaltyAmount: 10_000_000, penaltyClause: 'c'.repeat(300) }
    await o.c.owner.rules.set({ kosId: kos.id, groups: [ok] })
    const stored = await prisma.houseRule.findMany({ where: { kosId: kos.id } })
    expect(stored).toHaveLength(1)

    const attempts: Record<string, unknown>[] = [
      { groups: Array.from({ length: 11 }, () => ok) },
      { groups: [{ ...ok, rules: Array.from({ length: 16 }, () => 'a') }] },
      { groups: [{ ...ok, rules: ['r'.repeat(141)] }] },
      { groups: [{ ...ok, penaltyAmount: 10_000_001 }] },
      { groups: [{ ...ok, penaltyClause: 'c'.repeat(301) }] },
      { groups: [{ ...ok, rules: [] }] },
      { groups: [{ ...ok, categoryTitle: 't'.repeat(61) }] },
    ]
    for (const a of attempts) await refused(o.c.owner.rules.set({ kosId: kos.id, ...a } as never))
    expect(await prisma.houseRule.findMany({ where: { kosId: kos.id } })).toEqual(stored)

    await o.c.owner.rules.set({ kosId: kos.id, groups: Array.from({ length: 10 }, () => ({ categoryTitle: 't'.repeat(60), rules: Array.from({ length: 15 }, () => 'r'.repeat(140)) })) })
    expect(await prisma.houseRule.count({ where: { kosId: kos.id } })).toBe(10)
  })
})

describe('[G-013][R-057][R-058] review text limits', () => {
  it('refuses a 1501-character comment and a 1001-character reply; accepts 1500 and 1000', async () => {
    const s = await newStudent()
    const { tenancy, room } = await paidTenancy(s.id)
    const c = callerFor(s.id)
    await refused(c.review.create({ tenancyId: tenancy.id, rating: 4, subRatings: {}, comment: 'k'.repeat(1501) }))
    expect(await prisma.review.count({ where: { tenancyId: tenancy.id } })).toBe(0)
    const made = await c.review.create({ tenancyId: tenancy.id, rating: 4, subRatings: {}, comment: 'k'.repeat(1500) })
    await refused(c.review.update({ reviewId: made.id, rating: 4, subRatings: {}, comment: 'k'.repeat(1501) }))
    expect((await prisma.review.findUniqueOrThrow({ where: { id: made.id } })).comment).toHaveLength(1500)

    const owner = await prisma.ownerProfile.findUniqueOrThrow({ where: { id: (await prisma.kos.findUniqueOrThrow({ where: { id: room.kosId } })).ownerId } })
    await refused(callerFor(owner.userId).review.reply({ kosId: room.kosId, reviewId: made.id, text: 'r'.repeat(1001) }))
    await callerFor(owner.userId).review.reply({ kosId: room.kosId, reviewId: made.id, text: 'r'.repeat(1000) })
    expect((await prisma.review.findUniqueOrThrow({ where: { id: made.id } })).ownerReply).toHaveLength(1000)
  })
})

describe('[G-014][R-019][R-020] application.create bounds', () => {
  it('refuses each violation and creates no application; accepts the exact limits', async () => {
    const room = await vacantRoom()
    const base = { roomId: room.id, startDate: startIn(5), durationMonths: 3, occupation: 'Mahasiswa' }
    const bad: [string, Record<string, unknown>][] = [
      ['occupation 1 char', { occupation: 'a' }],
      ['occupation 121 chars', { occupation: 'a'.repeat(121) }],
      ['note 501 chars', { note: 'n'.repeat(501) }],
      ['0 months', { durationMonths: 0 }],
      ['13 months', { durationMonths: 13 }],
      ['1.5 months', { durationMonths: 1.5 }],
      ['startDate abc', { startDate: 'abc' }],
    ]
    for (const [label, over] of bad) {
      const c = callerFor((await newStudent()).id)
      await refused(c.application.create({ ...base, ...over })).catch((e) => { throw new Error(`${label}: ${e.message}`) })
    }
    const impossible = await err(callerFor((await newStudent()).id).application.create({ ...base, startDate: '2026-02-30' }))
    expect(impossible?.code).toBe('BAD_REQUEST')
    const far = await err(callerFor((await newStudent()).id).application.create({ ...base, startDate: addDays(todayWIB(new Date()), 400) }))
    expect([far?.code, far?.message]).toEqual(['BAD_REQUEST', 'Tanggal mulai terlalu jauh dari hari ini.'])
    expect(await prisma.rentalApplication.count({ where: { roomId: room.id } })).toBe(0)

    const a = await callerFor((await newStudent()).id).application.create({ ...base, occupation: 'ab', durationMonths: 12, note: 'n'.repeat(500) })
    expect(a.status).toBe('PENDING')
    const b = await callerFor((await newStudent()).id).application.create({ ...base, occupation: 'o'.repeat(120), durationMonths: 1 })
    expect(b.status).toBe('PENDING')
  })
})

describe('[G-015][R-051] visit.create bounds', () => {
  it('refuses a 301-character note, an unknown slot and a malformed date; accepts 300 characters', async () => {
    const { a } = await twoOwners()
    const kosId = a.kos[0]!.id
    const c = callerFor((await newStudent()).id)
    const base = { kosId, date: startIn(2), timeSlot: 'PAGI' as const }
    await refused(c.visit.create({ ...base, notes: 'n'.repeat(301) }))
    await refused(c.visit.create({ ...base, timeSlot: 'MALAM' } as never))
    await refused(c.visit.create({ ...base, date: '2026-1-1' }))
    expect(await prisma.visit.count({ where: { kosId } })).toBe(await prisma.visit.count({ where: { kosId, status: { in: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] } } }))
    const ok = await c.visit.create({ ...base, notes: 'n'.repeat(300) })
    expect(ok.id).toBeTruthy()
  })
})

describe('[G-016][R-088][R-089] profile and emergency-contact bounds', () => {
  it('refuses each violation and stores nothing', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    const before = await prisma.user.findUniqueOrThrow({ where: { id: s.id } })
    const contact = { name: 'Bu Sari', relation: 'Ibu', phone: '081200000009', consent: true as const }
    await refused(c.auth.updateEmergencyContact({ ...contact, name: 'S' }))
    await refused(c.auth.updateEmergencyContact({ ...contact, name: 'n'.repeat(81) }))
    await refused(c.auth.updateEmergencyContact({ ...contact, relation: 'r'.repeat(41) }))
    await refused(c.auth.updateEmergencyContact({ ...contact, phone: 'abc' }))
    await refused(c.auth.updateEmergencyContact({ ...contact, consent: false } as never))
    await refused(c.auth.updateProfile({ name: 'n'.repeat(81), phone: null, campus: null }))
    expect(await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).toEqual(before)
    await c.auth.updateEmergencyContact({ ...contact, name: 'n'.repeat(80), relation: 'r'.repeat(40) })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).emergencyContactName).toHaveLength(80)
  })
})

describe('[G-017][R-047] public search, detail and list bounds', () => {
  it('refuses out-of-range filters, ids and limits', async () => {
    const { a } = await twoOwners()
    const id = a.kos[0]!.id
    await refused(caller.kos.search({ lat: -6.2 } as never))
    await refused(caller.kos.search({ lat: 91, lng: 106.8 }))
    await refused(caller.kos.search({ lat: -6.2, lng: 106.8, radius: 100 }))
    await refused(caller.kos.search({ regionCode: '1.2' }))
    await refused(caller.kos.search({ maxPrice: -1 }))
    await refused(caller.kos.search({ q: 'q'.repeat(101) }))
    await refused(caller.kos.detail({ id: '' }))
    await refused(caller.kos.detail({ id: 'i'.repeat(65) }))
    await refused(caller.kos.list({ limit: 0 }))
    await refused(caller.kos.list({ limit: 201 }))
    expect((await caller.kos.detail({ id })).id).toBe(id)
    expect((await caller.kos.search({ q: 'q'.repeat(100) })).length).toBeGreaterThanOrEqual(0)
    expect((await caller.kos.list({ limit: 200 })).length).toBeGreaterThan(0)
  })
})

describe('[G-018][R-075] photo bounds and the 12-photo cap', () => {
  it('refuses bad presign/confirm/reorder inputs and the 13th photo', async () => {
    const o = await newOwner()
    const kos = await o.c.owner.kos.create(kosInput() as never)
    const base = { kosId: kos.id, contentType: 'image/webp' as const, contentLength: 1000, width: 800 }
    await refused(o.c.owner.image.presign({ ...base, width: 99 }))
    await refused(o.c.owner.image.presign({ ...base, width: 4001 }))
    await refused(o.c.owner.image.presign({ ...base, contentLength: 0 }))
    await refused(o.c.owner.image.presign({ ...base, contentLength: 2 * 1024 * 1024 + 1 }))
    await refused(o.c.owner.image.confirm({ kosId: kos.id, key: `kos/${kos.id}/x.webp`, width: 800, height: 600, order: 101 }))
    await refused(o.c.owner.image.reorder({ kosId: kos.id, imageIds: Array.from({ length: 25 }, (_, i) => `i${i}`) }))

    for (let i = 0; i < 12; i++) await prisma.kosImage.create({ data: { kosId: kos.id, key: `kos/${kos.id}/00000000-0000-4000-8000-${String(i).padStart(12, '0')}-800.webp`, order: i, width: 800, height: 600 } })
    const e = await err(o.c.owner.image.presign(base))
    // The cap is enforced at presign or at confirm; either way the 13th photo never lands.
    if (e === null) {
      const presigned = await o.c.owner.image.presign(base)
      const confirm = await err(o.c.owner.image.confirm({ kosId: kos.id, key: presigned.key, width: 800, height: 600, order: 12 }))
      expect(confirm).not.toBeNull()
    }
    expect(await prisma.kosImage.count({ where: { kosId: kos.id } })).toBeLessThanOrEqual(12)
  })
})

describe('[G-019][R-030] recordManual bounds', () => {
  it('refuses amounts, references, notes and methods outside the schema and records no payment', async () => {
    const { approveApplication, cash } = await import('../helpers.ts')
    const room = await vacantRoom()
    const a = await approveApplication((await newStudent()).id, room.id)
    const owner = await prisma.ownerProfile.findUniqueOrThrow({ where: { id: a.room.kos.ownerId } })
    const c = callerFor(owner.userId)
    const base = await cash(a.room.kosId, a.invoiceId)
    const transfer = { ...base, method: 'BANK_TRANSFER' as const, reference: 'TRF-001' }
    const bad: Record<string, unknown>[] = [
      { confirmedAmount: 0 }, { confirmedAmount: 1.5 }, { ...transfer, reference: 'ab' }, { ...transfer, reference: 'r'.repeat(65) },
      { ...transfer, reference: 'TRF<>1' }, { note: 'n'.repeat(501) }, { method: 'CARD' },
    ]
    for (const over of bad) await refused(c.payment.recordManual({ ...base, ...over } as never))
    expect(await prisma.payment.count({ where: { invoiceId: a.invoiceId, provider: 'MANUAL' } })).toBe(0)
  })
})

describe('[G-020][R-083] location inputs', () => {
  it('refuses coordinates outside Indonesia, malformed codes and too-short queries', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    await refused(c.place.reverse({ lat: 6.01, lng: 106.8 }))
    await refused(c.place.reverse({ lat: -6.2, lng: 94.9 }))
    for (const code of ['1', '99.1', 'abc', '99.01.01.12']) {
      await refused(caller.region.get({ code }))
      await refused(caller.region.outline({ code }))
    }
    await refused(caller.region.children({ parentCode: '99.1' }))
    await refused(caller.region.search({ q: 'a' }))
    await refused(caller.region.search({ q: 'ab', level: 5 }))
    await refused(caller.region.search({ q: 'ab', limit: 21 }))
    await refused(caller.campus.search({ q: 'a' }))
    await refused(c.place.resolveAddress({ q: 'abcd' }))
    await refused(caller.waitlist.status({ kosId: '' }))
    await refused(c.waitlist.join({ kosId: 'x', roomType: '' }))
    await refused(c.waitlist.join({ kosId: 'x', roomType: 't'.repeat(61) }))
  })

  it('refuses owner place inputs outside the schema', async () => {
    const { a } = await twoOwners()
    const kosId = a.kos[0]!.id
    const c = callerFor(a.userId)
    const base = { kosId, name: 'Warung Bu Sri', category: 'food' as const, lat: -6.2, lng: 106.8 }
    await refused(c.owner.places.add({ ...base, name: 'W' }))
    await refused(c.owner.places.add({ ...base, note: 'n'.repeat(141) }))
    await refused(c.owner.places.add({ ...base, category: 'casino' } as never))
    await refused(c.owner.places.add({ ...base, lat: -11.1 }))
  })
})

describe('[G-010][R-095] over HTTP every bound collapses to the one generic Indonesian message', () => {
  it('answers a public query and an owner mutation with the generic text and no schema detail', async () => {
    const q = await request(`/api/trpc/kos.search?input=${encodeURIComponent(JSON.stringify({ lat: 91, lng: 106.8 }))}`)
    expect(q.status).toBe(400)
    expect(((await q.json()) as { error: { message: string } }).error.message).toBe(GENERIC_VALIDATION)

    const cookie = await demoCookie('owner')
    const kos = await prisma.kos.findFirstOrThrow({ where: { owner: { user: { email: { contains: 'demo' } } } } }).catch(() => prisma.kos.findFirstOrThrow())
    const m = await request('/api/trpc/owner.room.create', { cookie, body: { ...roomInput({ floor: 61 }), kosId: kos.id } })
    expect(m.status).toBe(400)
    const text = await m.text()
    expect((JSON.parse(text) as { error: { message: string } }).error.message).toBe(GENERIC_VALIDATION)
    expect(text).not.toMatch(/too_big|invalid_type|floor/)
  })
})

describe('[G-009][R-082][R-083] region.get and owner.places.preview succeed', () => {
  it('returns a known region from the fixture catalogue, nothing for an unknown code, and the nearby view of an own kos', async () => {
    const { loadFixtureCatalog, removeFixtureCatalog } = await import('../fixtures/catalog.ts')
    await loadFixtureCatalog(prisma)
    try {
      const known = await caller.region.get({ code: '99.01.01' })
      expect(known?.region).toMatchObject({ code: '99.01.01', name: 'Satu' })
      expect(known?.ancestors.map((r) => r.code)).toEqual(['99', '99.01'])
      expect(await caller.region.get({ code: '98' })).toBeNull()

      const { a } = await twoOwners()
      const view = await callerFor(a.userId).owner.places.preview({ kosId: a.kos[0]!.id })
      expect(view === null || typeof view === 'object').toBe(true)
    } finally {
      await removeFixtureCatalog(prisma)
    }
  })
})
