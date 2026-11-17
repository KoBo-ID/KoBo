import { gridCell } from '@kobo/shared/domain'
import type { PrismaClient } from '../../src/db/client.ts'
import { clearRegionCache } from '../../src/regionLookup.ts'

/**
 * A small deterministic catalogue for tests and e2e: province 99 "Provinsi Uji" > 99.01 "Kota Uji" > two kecamatan side by
 * side, 40 places around ORIGIN and 6 campuses. Codes under 99 never exist in the real Kemendagri data. Never the real import.
 */
export const FIXTURE_VERSION = 'fixture'
export const ORIGIN = { lat: -6.25, lng: 106.65 }

const metersLat = (m: number) => m / 111_320
const metersLng = (m: number) => m / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180))
/** A point `north` metres north and `east` metres east of ORIGIN. */
export const at = (north: number, east: number) => ({ lat: ORIGIN.lat + metersLat(north), lng: ORIGIN.lng + metersLng(east) })

const square = (minLat: number, maxLat: number, minLng: number, maxLng: number) => ({
  type: 'MultiPolygon',
  coordinates: [[[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]]],
})

// Kecamatan Satu: lng 106.60..106.70; Kecamatan Dua: lng 106.70..106.80; both lat -6.30..-6.20.
const KEC1 = { minLat: -6.3, maxLat: -6.2, minLng: 106.6, maxLng: 106.7 }
const KEC2 = { minLat: -6.3, maxLat: -6.2, minLng: 106.7, maxLng: 106.8 }

export const REGIONS = [
  { code: '99', level: 1, name: 'Provinsi Uji', kind: 'provinsi', parentCode: null, lat: -6.25, lng: 106.7, ...{ minLat: -6.3, maxLat: -6.2, minLng: 106.6, maxLng: 106.8 }, polygon: square(-6.3, -6.2, 106.6, 106.8) },
  { code: '99.01', level: 2, name: 'Kota Uji', kind: 'kota', parentCode: '99', lat: -6.25, lng: 106.7, ...{ minLat: -6.3, maxLat: -6.2, minLng: 106.6, maxLng: 106.8 }, polygon: square(-6.3, -6.2, 106.6, 106.8) },
  { code: '99.01.01', level: 3, name: 'Satu', kind: 'kecamatan', parentCode: '99.01', lat: -6.25, lng: 106.65, ...KEC1, polygon: square(KEC1.minLat, KEC1.maxLat, KEC1.minLng, KEC1.maxLng) },
  { code: '99.01.02', level: 3, name: 'Dua', kind: 'kecamatan', parentCode: '99.01', lat: -6.25, lng: 106.75, ...KEC2, polygon: square(KEC2.minLat, KEC2.maxLat, KEC2.minLng, KEC2.maxLng) },
  { code: '99.01.01.1001', level: 4, name: 'Pakulonan Uji', kind: 'kelurahan', parentCode: '99.01.01', lat: -6.26, lng: 106.64, polygon: null },
  { code: '99.01.01.2001', level: 4, name: 'Desa Timur', kind: 'desa', parentCode: '99.01.01', lat: -6.24, lng: 106.67, polygon: null },
  { code: '99.01.02.1001', level: 4, name: 'Kelurahan Seberang', kind: 'kelurahan', parentCode: '99.01.02', lat: -6.25, lng: 106.75, polygon: null },
] as const

type Cat = 'food' | 'minimarket' | 'laundry' | 'print' | 'atm' | 'pharmacy' | 'clinic' | 'hospital' | 'worship' | 'gym' | 'cafe' | 'transit' | 'pasar'
interface FixturePlace {
  n: number
  category: Cat
  name: string
  north: number
  east: number
  brand?: string
  score?: number
  hidden?: boolean
}

// 40 places. Distances are chosen to exercise the radius table: food has 3 near, 8 in the show-more band and 1 beyond.
const food = (n: number, name: string, east: number, extra: Partial<FixturePlace> = {}): FixturePlace => ({ n, category: 'food', name, north: 0, east, ...extra })
export const PLACES: FixturePlace[] = [
  food(1, 'Warung Bu Sri', 100), food(2, 'Warteg Bahari', 200), food(3, 'Kantin Kampus', 300),
  ...Array.from({ length: 8 }, (_, i) => food(4 + i, `Rumah Makan ${i + 1}`, 600 + i * 40)),
  food(12, 'Depot Jauh', 4000),
  { n: 13, category: 'minimarket', name: 'Indomaret A', north: 100, east: 0, brand: 'Indomaret' },
  { n: 14, category: 'minimarket', name: 'Indomaret B', north: 200, east: 0, brand: 'Indomaret' },
  { n: 15, category: 'minimarket', name: 'Indomaret C', north: 300, east: 0, brand: 'Indomaret' },
  { n: 16, category: 'minimarket', name: 'Toko Pak Joko', north: 350, east: 0 },
  { n: 17, category: 'laundry', name: 'Laundry Kiloan Segar', north: 0, east: -250 },
  { n: 18, category: 'laundry', name: 'Laundry Tersembunyi', north: 0, east: -300, hidden: true },
  { n: 19, category: 'print', name: 'Fotokopi Cepat', north: -150, east: 0 },
  { n: 20, category: 'atm', name: 'ATM BCA', north: 0, east: 500 },
  { n: 21, category: 'atm', name: 'Bank Mandiri', north: 0, east: 900 },
  { n: 22, category: 'pharmacy', name: 'Apotek Sehat', north: -600, east: 0 },
  { n: 23, category: 'clinic', name: 'Klinik Pratama', north: 700, east: 0 },
  { n: 24, category: 'hospital', name: 'RS Umum Uji', north: 0, east: 2500 },
  { n: 25, category: 'hospital', name: 'RS Jauh', north: 0, east: 7000 },
  { n: 26, category: 'worship', name: 'Masjid Al-Ikhlas', north: -200, east: -200 },
  { n: 27, category: 'worship', name: 'Musala Nur', north: 150, east: 150 },
  { n: 28, category: 'worship', name: 'Gereja Uji', north: 1200, east: 0 },
  { n: 29, category: 'gym', name: 'Gym Kuat', north: -800, east: 0 },
  { n: 30, category: 'cafe', name: 'Kopi Tugas', north: 0, east: 400 },
  { n: 31, category: 'cafe', name: 'Coworking Satu', north: 0, east: 1500 },
  { n: 32, category: 'transit', name: 'Halte Uji', north: 300, east: -300 },
  { n: 33, category: 'transit', name: 'Stasiun Uji', north: 2200, east: 0 },
  { n: 34, category: 'pasar', name: 'Pasar Lama', north: 1400, east: 0 },
  // In the other kecamatan, 6 km east: out of range for a kos at ORIGIN, in range for one at the east edge.
  { n: 35, category: 'food', name: 'Warung Seberang', north: 0, east: 6000 },
  { n: 36, category: 'food', name: 'Warung Seberang 2', north: 100, east: 6000 },
  { n: 37, category: 'laundry', name: 'Laundry Seberang', north: 0, east: 6100 },
  { n: 38, category: 'minimarket', name: 'Alfamart Seberang', north: 0, east: 6000, brand: 'Alfamart' },
  { n: 39, category: 'cafe', name: 'Kafe Seberang', north: 0, east: 6200 },
  { n: 40, category: 'worship', name: 'Masjid Seberang', north: 0, east: 6300 },
]

export const CAMPUSES = [
  { id: 'fx-campus-a', name: 'Universitas Uji A', shortName: 'UUA', city: 'Kota Uji', ...at(900, 0), gate: at(700, 0) },
  { id: 'fx-campus-b', name: 'Institut Uji B', shortName: 'IUB', city: 'Kota Uji', ...at(0, -3000), gate: null },
  { id: 'fx-campus-c', name: 'Politeknik Uji C', shortName: 'PUC', city: 'Kota Uji', ...at(0, 4000), gate: null },
  { id: 'fx-campus-d', name: 'Sekolah Tinggi Uji D', shortName: 'STUD', city: 'Kota Uji', ...at(-2000, 0), gate: null },
  { id: 'fx-campus-e', name: 'Akademi Uji E', shortName: 'AUE', city: 'Kota Uji', ...at(0, 20_000), gate: null },
  { id: 'fx-campus-f', name: 'Universitas Jauh F', shortName: 'UJF', city: 'Kota Jauh', lat: -5.0, lng: 107.5, gate: null },
] as const

export async function removeFixtureCatalog(prisma: PrismaClient): Promise<void> {
  await prisma.kosPlace.deleteMany({})
  await prisma.region.deleteMany({ where: { dataVersion: FIXTURE_VERSION } })
  await prisma.placeCatalog.deleteMany({ where: { dataVersion: FIXTURE_VERSION } })
  await prisma.kos.updateMany({ where: { nearestCampusId: { startsWith: 'fx-campus-' } }, data: { nearestCampusId: null, nearestCampusMeters: null } })
  await prisma.campus.deleteMany({ where: { dataVersion: FIXTURE_VERSION } })
  await prisma.catalogMeta.deleteMany({ where: { version: { startsWith: `places-osm:${FIXTURE_VERSION}` } } })
  clearRegionCache()
}

export async function loadFixtureCatalog(prisma: PrismaClient): Promise<void> {
  await removeFixtureCatalog(prisma)
  await prisma.region.createMany({
    data: REGIONS.map((r) => ({
      code: r.code, level: r.level, name: r.name, kind: r.kind, parentCode: r.parentCode, lat: r.lat, lng: r.lng,
      minLat: 'minLat' in r ? r.minLat : null, maxLat: 'maxLat' in r ? r.maxLat : null, minLng: 'minLng' in r ? r.minLng : null, maxLng: 'maxLng' in r ? r.maxLng : null,
      polygon: r.polygon ?? undefined, polygonProvenance: r.polygon ? 'fixture' : null, dataVersion: FIXTURE_VERSION,
    })),
  })
  await prisma.placeCatalog.createMany({
    data: PLACES.map((p) => {
      const pt = at(p.north, p.east)
      return {
        id: `poi-osm-nf${p.n}`, source: 'osm', sourceId: `nf${p.n}`, category: p.category, subcategory: null, name: p.name, brand: p.brand ?? null,
        lat: pt.lat, lng: pt.lng, cell: gridCell(pt.lat, pt.lng), desaCode: null, score: p.score ?? 4, licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors',
        derivedFromOsm: true, isHidden: p.hidden ?? false, dataVersion: FIXTURE_VERSION,
      }
    }),
  })
  await prisma.campus.createMany({
    data: CAMPUSES.map((c) => ({
      id: c.id, name: c.name, shortName: c.shortName, city: c.city, lat: c.lat, lng: c.lng, emailDomains: [], gateLat: c.gate?.lat ?? null, gateLng: c.gate?.lng ?? null, aliases: [], dataVersion: FIXTURE_VERSION,
    })),
    skipDuplicates: true,
  })
  await prisma.catalogMeta.upsert({
    where: { version: `places-osm:${FIXTURE_VERSION}` },
    create: { version: `places-osm:${FIXTURE_VERSION}`, dataset: 'places-osm', status: 'active', rowCount: PLACES.length },
    update: { status: 'active', rowCount: PLACES.length },
  })
}
