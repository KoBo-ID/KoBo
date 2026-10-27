import type { TRPCError } from '@trpc/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { gridCell } from '@kobo/shared/domain'
import { resetDb } from '../../src/db/seed.ts'
import { attachPlaces, loadNearby, nearestCampuses, placesNear } from '../../src/placeCatalog.ts'
import { regionLookup } from '../../src/regionLookup.ts'
import { at, loadFixtureCatalog, ORIGIN, removeFixtureCatalog } from '../fixtures/catalog.ts'
import { caller, callerFor, prisma } from '../helpers.ts'

beforeAll(() => loadFixtureCatalog(prisma))
afterAll(() => removeFixtureCatalog(prisma))
beforeEach(async () => {
  await resetDb(prisma)
  await loadFixtureCatalog(prisma)
})

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code
const message = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.message

async function ownerWithKos() {
  const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: {} } }, include: { kos: { take: 2, orderBy: { id: 'asc' } } } })
  return { userId: owner.userId, kos: owner.kos[0]!, other: await prisma.kos.findFirstOrThrow({ where: { ownerId: { not: owner.id } } }) }
}
/** Moves a seeded kos to the fixture origin so the fixture places are around it. */
async function kosAtOrigin() {
  const o = await ownerWithKos()
  await prisma.kos.update({ where: { id: o.kos.id }, data: { lat: ORIGIN.lat, lng: ORIGIN.lng } })
  return o
}

describe('regionLookup', () => {
  it('finds the kecamatan by polygon and the nearest desa inside it', async () => {
    const hit = await regionLookup(prisma, ORIGIN)
    expect(hit?.kecamatan.code).toBe('99.01.01')
    expect(hit?.kabKota?.name).toBe('Kota Uji')
    expect(hit?.provinsi?.code).toBe('99')
    expect(hit?.confidence).toBe('polygon')
    expect(hit?.desa?.code).toMatch(/^99\.01\.01\./)
    expect(hit?.finestCode).toBe(hit?.desa?.code)
  })

  it('picks the right side of a shared border', async () => {
    expect((await regionLookup(prisma, { lat: -6.25, lng: 106.69 }))?.kecamatan.code).toBe('99.01.01')
    expect((await regionLookup(prisma, { lat: -6.25, lng: 106.71 }))?.kecamatan.code).toBe('99.01.02')
  })

  it('takes the nearest polygon within 500 m of the edge and flags it', async () => {
    const hit = await regionLookup(prisma, { lat: -6.2, lng: 106.6 + 0.0 })
    expect(hit).not.toBeNull()
    const sea = await regionLookup(prisma, { lat: -6.2 + 0.003, lng: 106.65 })
    expect(sea?.confidence).toBe('sea_fallback')
    expect(sea?.kecamatan.code).toBe('99.01.01')
  })

  it('falls back to the nearest centroid, flagged lower confidence, a few km outside; nothing far away', async () => {
    const near = await regionLookup(prisma, { lat: -6.2 + 0.05, lng: 106.65 })
    expect(near?.confidence).toBe('nearest')
    expect(await regionLookup(prisma, { lat: -2.0, lng: 120.0 })).toBeNull()
  })
})

describe('placesNear', () => {
  it('ranks named places per category within the radius table, caps and chain rule', async () => {
    const ranked = await placesNear(prisma, ORIGIN)
    const food = ranked.find((r) => r.category === 'food')!
    expect(food.primary.map((p) => p.name)).toEqual(expect.arrayContaining(['Warung Bu Sri', 'Warteg Bahari', 'Kantin Kampus']))
    expect(food.primary.every((p) => p.distanceM <= 500)).toBe(true)
    expect(food.more.length).toBeGreaterThan(0)
    expect(food.more.every((p) => p.distanceM > 500 || food.primary.length < 5)).toBe(true)
    expect([...food.primary, ...food.more].some((p) => p.name === 'Depot Jauh')).toBe(false)

    const mini = ranked.find((r) => r.category === 'minimarket')!
    expect([...mini.primary, ...mini.more].filter((p) => p.brand === 'Indomaret')).toHaveLength(2)
  })

  it('never returns catalogue-hidden places or places from the far kecamatan', async () => {
    const all = (await placesNear(prisma, ORIGIN)).flatMap((r) => [...r.primary, ...r.more])
    expect(all.some((p) => p.name === 'Laundry Tersembunyi')).toBe(false)
    expect(all.some((p) => p.name.endsWith('Seberang'))).toBe(false)
  })

  it('reports distances in straight-line metres, nearest first within equal scores', async () => {
    const food = (await placesNear(prisma, ORIGIN, ['food']))[0]!
    expect(food.primary[0]!.distanceM).toBeGreaterThan(80)
    expect(food.primary[0]!.distanceM).toBeLessThan(120)
  })
})

describe('nearestCampuses', () => {
  it('returns up to 3 within the maximum, using the gate when one is known', async () => {
    const list = await nearestCampuses(prisma, ORIGIN, 3)
    expect(list.map((c) => c.id)).toEqual(['fx-campus-a', 'fx-campus-d', 'fx-campus-b'].slice(0, list.length).sort((a, b) => list.findIndex((x) => x.id === a) - list.findIndex((x) => x.id === b)))
    const a = list.find((c) => c.id === 'fx-campus-a')!
    expect(a.toGate).toBe(true)
    expect(a.meters).toBeGreaterThan(650)
    expect(a.meters).toBeLessThan(750)
    expect(list.every((c) => c.meters <= 10_000)).toBe(true)
    expect(list.find((c) => c.id === 'fx-campus-f')).toBeUndefined()
  })

  it('n = 1 matches the old single-nearest behaviour', async () => {
    const [one] = await nearestCampuses(prisma, at(0, -3000), 1)
    expect(one?.id).toBe('fx-campus-b')
  })
})

describe('snapshot by reference', () => {
  it('attachPlaces stores references, loadNearby builds the grouped view with honest labels', async () => {
    const { kos } = await kosAtOrigin()
    const res = await prisma.$transaction((tx) => attachPlaces(tx, kos.id))
    expect(res.rows).toBeGreaterThan(10)
    const snap = await prisma.kosPlace.findMany({ where: { kosId: kos.id } })
    expect(snap.every((s) => s.placeId.startsWith('poi-osm-') || s.placeId.startsWith('fx-campus-') || !s.placeId.startsWith('poi-owner'))).toBe(true)
    const view = await loadNearby(prisma, kos.id)
    expect(view?.distanceNote).toBe('garis lurus')
    expect(view?.attribution.text).toBe('© OpenStreetMap contributors')
    const food = view!.groups.find((g) => g.category === 'food')!
    expect(food.items[0]!.distanceLabel).toMatch(/garis lurus$/)
    expect(food.items[0]!.minutesNote).toMatch(/mnt jalan kaki \(perkiraan\)$/)
    expect(view!.groups.some((g) => g.category === 'campus')).toBe(true)
  })

  it('lists Overture in the attributions only when one of its places is shown', async () => {
    const { userId, kos } = await kosAtOrigin()
    const owner = callerFor(userId)
    await owner.owner.places.refresh({ kosId: kos.id })
    expect((await loadNearby(prisma, kos.id))!.attributions.map((a) => a.text)).toEqual(['© OpenStreetMap contributors'])
    const pt = at(30, 30)
    await prisma.placeCatalog.create({ data: { id: 'poi-ovt-fx1', source: 'overture', sourceId: 'fx-uuid-1', category: 'laundry', name: 'Laundry Overture', lat: pt.lat, lng: pt.lng, cell: gridCell(pt.lat, pt.lng), score: 4, licence: 'CDLA-Permissive-2.0', attribution: 'Overture Maps Foundation', derivedFromOsm: false, dataVersion: 'fixture' } })
    await owner.owner.places.refresh({ kosId: kos.id })
    const view = (await loadNearby(prisma, kos.id))!
    expect(view.attributions.map((a) => a.text)).toContain('Overture Maps Foundation')
    expect(view.groups.flatMap((g) => g.items).find((i) => i.id === 'poi-ovt-fx1')?.sourceLabel).toBe('Overture Maps')
  })

  it('snapshot rows reference catalogue ids, not copies of names', async () => {
    const { kos } = await kosAtOrigin()
    await prisma.$transaction((tx) => attachPlaces(tx, kos.id))
    const cols = Object.keys((await prisma.kosPlace.findFirstOrThrow({ where: { kosId: kos.id } })) as object)
    expect(cols).not.toContain('name')
    expect(cols).not.toContain('lat')
  })

  it('a hidden place survives a refresh and stays out of the public view; unhide brings it back', async () => {
    const { userId, kos } = await kosAtOrigin()
    const owner = callerFor(userId)
    await owner.owner.places.refresh({ kosId: kos.id })
    await owner.owner.places.hide({ kosId: kos.id, placeId: 'poi-osm-nf1' })
    await owner.owner.places.refresh({ kosId: kos.id })
    const row = await prisma.kosPlace.findFirstOrThrow({ where: { kosId: kos.id, placeId: 'poi-osm-nf1' } })
    expect(row.hiddenByOwner).toBe(true)
    const hiddenView = await loadNearby(prisma, kos.id)
    expect(hiddenView!.groups.flatMap((g) => [...g.items, ...g.more]).some((i) => i.id === 'poi-osm-nf1')).toBe(false)
    await owner.owner.places.unhide({ kosId: kos.id, placeId: 'poi-osm-nf1' })
    const back = await loadNearby(prisma, kos.id)
    expect(back!.groups.flatMap((g) => [...g.items, ...g.more]).some((i) => i.id === 'poi-osm-nf1')).toBe(true)
  })

  it('kos.detail returns nearby, and still returns the legacy pois', async () => {
    const { userId, kos } = await kosAtOrigin()
    await callerFor(userId).owner.places.refresh({ kosId: kos.id })
    const detail = await caller.kos.detail({ id: kos.id })
    expect(detail.nearby?.groups.length).toBeGreaterThan(0)
    expect(Array.isArray(detail.pois)).toBe(true)
  })

  it('kos.detail has nearby = null before any snapshot exists', async () => {
    const { kos } = await ownerWithKos()
    await prisma.kosPlace.deleteMany({ where: { kosId: kos.id } })
    expect((await caller.kos.detail({ id: kos.id })).nearby).toBeNull()
  })
})

describe('owner.places', () => {
  it('only the kos owner can use it', async () => {
    const { userId, kos, other } = await ownerWithKos()
    expect(await code(caller.owner.places.list({ kosId: kos.id }))).toBe('UNAUTHORIZED')
    expect(await code(callerFor(userId).owner.places.list({ kosId: other.id }))).toBe('FORBIDDEN')
    expect(await code(callerFor(userId).owner.places.hide({ kosId: other.id, placeId: 'x' }))).toBe('FORBIDDEN')
  })

  it('add lands as pending, is invisible to the public, and is listed for the owner', async () => {
    const { userId, kos } = await kosAtOrigin()
    const owner = callerFor(userId)
    const p = at(100, 100)
    const added = await owner.owner.places.add({ kosId: kos.id, name: 'Warung Baru Ibu Ani', category: 'food', lat: p.lat, lng: p.lng, note: 'Buka pagi' })
    expect(added.status).toBe('pending')
    await owner.owner.places.refresh({ kosId: kos.id })
    const view = await loadNearby(prisma, kos.id)
    expect(JSON.stringify(view)).not.toContain('Warung Baru Ibu Ani')
    const list = await owner.owner.places.list({ kosId: kos.id })
    expect(list.find((r) => r.id === added.id)?.status).toBe('pending')
  })

  it('once approved it shows with a badge, and survives a refresh', async () => {
    const { userId, kos } = await kosAtOrigin()
    const owner = callerFor(userId)
    const p = at(50, 50)
    const added = await owner.owner.places.add({ kosId: kos.id, name: 'Laundry Ibu Ani', category: 'laundry', lat: p.lat, lng: p.lng })
    await prisma.ownerPlace.update({ where: { id: added.id }, data: { status: 'approved' } })
    await owner.owner.places.refresh({ kosId: kos.id })
    const item = (await loadNearby(prisma, kos.id))!.groups.flatMap((g) => g.items).find((i) => i.id === added.id)
    expect(item?.addedByOwner).toBe(true)
    expect(item?.sourceLabel).toBe('Pemilik kos')
  })

  it('rejects phone numbers, links and handles in the name or note', async () => {
    const { userId, kos } = await kosAtOrigin()
    const owner = callerFor(userId)
    const base = { kosId: kos.id, category: 'food' as const, ...at(10, 10) }
    for (const name of ['Warung 0812-3456-7890', 'Toko www.toko.com', 'ig @warungani']) {
      expect(await code(owner.owner.places.add({ ...base, name }))).toBe('BAD_REQUEST')
    }
    expect(await message(owner.owner.places.add({ ...base, name: 'Warung Ani', note: 'hubungi 081234567890' }))).toMatch(/nomor telepon/)
  })

  it('rejects a place more than 3 km from the kos and caps owner-added places at 30', async () => {
    const { userId, kos } = await kosAtOrigin()
    const owner = callerFor(userId)
    expect(await code(owner.owner.places.add({ kosId: kos.id, name: 'Tempat Jauh', category: 'food', ...at(0, 5000) }))).toBe('BAD_REQUEST')
    for (let i = 0; i < 30; i++) await prisma.ownerPlace.create({ data: { kosId: kos.id, name: `Tempat ${i}`, category: 'food', ...at(10, 10) } })
    expect(await code(owner.owner.places.add({ kosId: kos.id, name: 'Tempat ke-31', category: 'food', ...at(10, 10) }))).toBe('CONFLICT')
  })

  it('remove deletes an owner-added place only', async () => {
    const { userId, kos } = await kosAtOrigin()
    const owner = callerFor(userId)
    const added = await owner.owner.places.add({ kosId: kos.id, name: 'Warung Hapus', category: 'food', ...at(20, 20) })
    await owner.owner.places.remove({ kosId: kos.id, placeId: added.id })
    expect(await prisma.ownerPlace.count({ where: { id: added.id } })).toBe(0)
    expect(await code(owner.owner.places.remove({ kosId: kos.id, placeId: 'poi-osm-nf1' }))).toBe('NOT_FOUND')
  })

  it('moving the pin re-runs region and the snapshot and keeps hides by placeId', async () => {
    const { userId, kos } = await ownerWithKos()
    const owner = callerFor(userId)
    await prisma.kos.update({ where: { id: kos.id }, data: { lat: ORIGIN.lat, lng: ORIGIN.lng } })
    await owner.owner.places.refresh({ kosId: kos.id })
    await owner.owner.places.hide({ kosId: kos.id, placeId: 'poi-osm-nf17' })
    const full = await prisma.kos.findUniqueOrThrow({ where: { id: kos.id } })
    await owner.owner.kos.update({
      kosId: kos.id, name: full.name, gender: full.gender, address: full.address, district: full.district, city: full.city,
      lat: ORIGIN.lat + 0.0005, lng: ORIGIN.lng, electricityType: full.electricityType, privateAmenities: full.privateAmenities, sharedAmenities: full.sharedAmenities,
      studentDiscountAmount: full.studentDiscountAmount, applicationFee: full.applicationFee,
    } as never)
    const after = await prisma.kos.findUniqueOrThrow({ where: { id: kos.id } })
    expect(after.desaCode).toMatch(/^99\.01\.01\./)
    expect(['polygon', 'sea_fallback', 'nearest']).toContain(after.regionConfidence)
    expect((await prisma.kosPlace.findFirstOrThrow({ where: { kosId: kos.id, placeId: 'poi-osm-nf17' } })).hiddenByOwner).toBe(true)
  })
})

describe('place.reverse and place.resolveAddress', () => {
  it('reverse needs a session and returns region, campuses and a preview', async () => {
    const { userId } = await ownerWithKos()
    expect(await code(caller.place.reverse({ ...ORIGIN }))).toBe('UNAUTHORIZED')
    const res = await callerFor(userId).place.reverse({ ...ORIGIN })
    expect(res.region?.kecamatan.name).toBe('Satu')
    expect(res.campuses.length).toBeGreaterThan(0)
    expect(res.places.find((p) => p.category === 'food')?.items.length).toBeLessThanOrEqual(2)
  })

  it('reverse refuses coordinates outside Indonesia', async () => {
    const { userId } = await ownerWithKos()
    expect(await code(callerFor(userId).place.reverse({ lat: 48.8, lng: 2.3 }))).toBe('BAD_REQUEST')
  })

  it('resolveAddress asks for confirmation when the named kecamatan is not the one the point lies in', async () => {
    const { userId } = await ownerWithKos()
    const geocoder = {
      search: async () => null,
      resolveAddress: async () => ({ label: 'x', ...ORIGIN, city: 'Kota Uji', district: 'Pakulonan Uji, Dua', precision: 'exact' as const }),
    }
    const res = await callerFor(userId, { geocoder }).place.resolveAddress({ q: 'Jl. Contoh No. 1 Kota Uji' })
    expect(res?.region?.kecamatan.name).toBe('Satu')
    expect(res?.needsConfirmation).toBe(true)
    expect(res?.confirmationNote).toMatch(/Kecamatan Satu/)
  })

  it('resolveAddress asks for confirmation when the point only matched the nearest area (near a boundary or the coast)', async () => {
    const { userId } = await ownerWithKos()
    const geocoder = {
      search: async () => null,
      resolveAddress: async () => ({ label: 'x', lat: -6.2 + 0.003, lng: 106.65, city: 'Kota Uji', district: 'Pakulonan Uji, Satu', precision: 'exact' as const }),
    }
    const res = await callerFor(userId, { geocoder }).place.resolveAddress({ q: 'Jl. Pinggir Batas No. 1 Kota Uji' })
    expect(res?.region?.confidence).toBe('sea_fallback')
    expect(res?.needsConfirmation).toBe(true)
    expect(res?.confirmationNote).toMatch(/dekat batas wilayah/)
  })

  it('resolveAddress compares district names without spacing ("Gedong Tengen" = "Gedongtengen")', async () => {
    const { userId } = await ownerWithKos()
    const geocoder = {
      search: async () => null,
      resolveAddress: async () => ({ label: 'x', ...ORIGIN, city: 'Kota Uji', district: 'Pakulonan Uji, Kec. S atu', precision: 'exact' as const }),
    }
    const res = await callerFor(userId, { geocoder }).place.resolveAddress({ q: 'Jl. Contoh No. 1 Kota Uji' })
    expect(res?.needsConfirmation).toBe(false)
  })

  it('resolveAddress does not flag a matching kecamatan, whatever the prefix', async () => {
    const { userId } = await ownerWithKos()
    const geocoder = {
      search: async () => null,
      resolveAddress: async () => ({ label: 'x', ...ORIGIN, city: 'Kota Uji', district: 'Pakulonan Uji, Kecamatan Satu', precision: 'exact' as const }),
    }
    const res = await callerFor(userId, { geocoder }).place.resolveAddress({ q: 'Jl. Contoh No. 1 Kota Uji' })
    expect(res?.needsConfirmation).toBe(false)
  })
})

describe('region, campus and search', () => {
  it('region.children walks down from the provinces; region.search tolerates prefixes', async () => {
    expect((await caller.region.children({})).some((r) => r.code === '99')).toBe(true)
    expect((await caller.region.children({ parentCode: '99.01' })).map((r) => r.code)).toEqual(['99.01.02', '99.01.01'])
    const hit = await caller.region.search({ q: 'kota uji' })
    expect(hit[0]?.code).toBe('99.01')
    expect((await caller.region.search({ q: 'Kecamatan Satu' })).some((r) => r.code === '99.01.01')).toBe(true)
  })

  it('region.search treats % and _ literally', async () => {
    expect(await caller.region.search({ q: '%%' })).toEqual([])
  })

  it('campus.search finds by name, short name and city, prefix first', async () => {
    expect((await caller.campus.search({ q: 'universitas uji' }))[0]?.id).toBe('fx-campus-a')
    expect((await caller.campus.search({ q: 'IUB' }))[0]?.id).toBe('fx-campus-b')
    expect((await caller.campus.search({ q: 'Kota Jauh' })).map((c) => c.id)).toContain('fx-campus-f')
  })

  it('kos.search filters by regionCode at any level and keeps other filters', async () => {
    const { kos } = await ownerWithKos()
    await prisma.kos.update({ where: { id: kos.id }, data: { desaCode: '99.01.01.1001', regionConfidence: 'polygon' } })
    for (const regionCode of ['99', '99.01', '99.01.01', '99.01.01.1001']) {
      expect((await caller.kos.search({ regionCode })).map((k) => k.id)).toEqual([kos.id])
    }
    expect(await caller.kos.search({ regionCode: '99.01.02' })).toEqual([])
    expect(await caller.kos.search({ regionCode: '99.01.01', maxPrice: 1 })).toEqual([])
  })

  it('catalog.status is for allow-listed operators only', async () => {
    const { userId } = await ownerWithKos()
    expect(await code(callerFor(userId).catalog.status())).toBe('FORBIDDEN')
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    process.env.CATALOG_ADMIN_EMAILS = user.email
    try {
      const s = await callerFor(userId).catalog.status()
      expect(s.counts.places).toBeGreaterThan(0)
    } finally {
      delete process.env.CATALOG_ADMIN_EMAILS
    }
  })

  it('catalog.licenses is public and names OpenStreetMap with its attribution', async () => {
    const l = await caller.catalog.licenses()
    expect(l.sources.find((s) => s.id === 'osm')?.attribution).toBe('© OpenStreetMap contributors')
  })
})

describe('reference tables survive resetDb', () => {
  it('Region, PlaceCatalog, CatalogMeta and imported Campus rows are untouched; seeded campuses are replaced', async () => {
    const before = { r: await prisma.region.count(), p: await prisma.placeCatalog.count(), m: await prisma.catalogMeta.count(), c: await prisma.campus.count({ where: { dataVersion: { not: null } } }) }
    expect(before.r).toBeGreaterThan(0)
    await resetDb(prisma)
    expect(await prisma.region.count()).toBe(before.r)
    expect(await prisma.placeCatalog.count()).toBe(before.p)
    expect(await prisma.catalogMeta.count()).toBe(before.m)
    expect(await prisma.campus.count({ where: { dataVersion: { not: null } } })).toBe(before.c)
    expect(await prisma.campus.count({ where: { dataVersion: null } })).toBeGreaterThan(0)
  })

  it('PlaceCatalog has no foreign key to an app table, so a CASCADE cannot reach it', async () => {
    const fks = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND (conrelid = '"PlaceCatalog"'::regclass OR conrelid = '"Region"'::regclass OR confrelid = '"PlaceCatalog"'::regclass OR confrelid = '"Region"'::regclass)`
    expect(fks[0]!.n).toBe(0)
  })

  it('the OSM-derived view lists exactly the flagged rows', async () => {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM v_osm_derived_places`
    expect(n).toBe(await prisma.placeCatalog.count({ where: { derivedFromOsm: true } }))
  })

  it('kos_area_stats counts shown places per category', async () => {
    const { userId, kos } = await kosAtOrigin()
    await callerFor(userId).owner.places.refresh({ kosId: kos.id })
    const rows = await prisma.$queryRaw<{ category: string; places: number }[]>`SELECT category, places FROM kos_area_stats WHERE "kosId" = ${kos.id}`
    expect(rows.find((r) => r.category === 'food')!.places).toBeGreaterThan(0)
  })
})
