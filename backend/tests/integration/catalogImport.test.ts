import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gridCell } from '@kobo/shared/domain'
import { CatalogImportError, importCampuses, importPlaces, importRegions, rollbackTo } from '../../scripts/catalog/import.ts'
import { parseCsv } from '../../scripts/catalog/files.ts'
import { prisma } from '../helpers.ts'

const dir = mkdtempSync(join(tmpdir(), 'kobo-catalog-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const esc = (v: string | number) => {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function writeCsv(name: string, columns: string[], rows: Record<string, string | number>[]): string {
  const text = [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c] ?? '')).join(','))].join('\n') + '\n'
  const path = join(dir, name)
  writeFileSync(path, name.endsWith('.gz') ? gzipSync(text) : text)
  return path
}

const REGION_COLS = ['code', 'level', 'name', 'kind', 'parent_code', 'lat', 'lng', 'min_lat', 'max_lat', 'min_lng', 'max_lng', 'postal_code', 'polygon', 'polygon_provenance', 'data_version', 'source', 'licence']
const PLACE_COLS = ['id', 'source', 'source_id', 'category', 'subcategory', 'name', 'name_alt', 'brand', 'lat', 'lng', 'cell', 'desa_code', 'hours_raw', 'website', 'osm_type', 'osm_id', 'score', 'licence', 'attribution', 'derived_from_osm', 'first_seen', 'updated_at', 'is_hidden', 'data_version']
const CAMPUS_COLS = ['id', 'name', 'short_name', 'city', 'lat', 'lng', 'kind', 'parent_id', 'pddikti_id', 'osm_id', 'wikidata_id', 'desa_code', 'gate_lat', 'gate_lng', 'coord_method', 'verified_at', 'email_domains', 'website', 'aliases', 'licence', 'source', 'data_version']

const region = (code: string, version: string, over: Record<string, string | number> = {}) => ({
  code, level: code.split('.').length, name: `Wilayah ${code}`, kind: 'kecamatan', parent_code: code.includes('.') ? code.slice(0, code.lastIndexOf('.')) : '', lat: -6.25, lng: 106.65,
  min_lat: -6.3, max_lat: -6.2, min_lng: 106.6, max_lng: 106.7, postal_code: '', polygon: '{"type":"MultiPolygon","coordinates":[[[[106.6,-6.3],[106.7,-6.3],[106.7,-6.2],[106.6,-6.3]]]]}',
  polygon_provenance: 'unconfirmed', data_version: version, source: 'cahyadsn/wilayah', licence: 'MIT', ...over,
})
const place = (n: number, version: string, over: Record<string, string | number> = {}) => ({
  id: `poi-osm-nz${n}`, source: 'osm', source_id: `n${9000 + n}`, category: 'food', subcategory: 'restoran', name: `Warung, "Uji" ${n}`, name_alt: '', brand: '', lat: -6.25 + n * 0.0001, lng: 106.65,
  cell: gridCell(-6.25 + n * 0.0001, 106.65), desa_code: '', hours_raw: '', website: '', osm_type: 'n', osm_id: n, score: 4, licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors',
  derived_from_osm: 1, first_seen: '', updated_at: '2026-01-01', is_hidden: 0, data_version: version, ...over,
})

async function cleanImportData() {
  await prisma.region.deleteMany({ where: { code: { startsWith: '98' } } })
  await prisma.placeCatalog.deleteMany({ where: { id: { startsWith: 'poi-osm-nz' } } })
  await prisma.campus.deleteMany({ where: { id: { startsWith: 'cmp-imp-' } } })
  await prisma.catalogMeta.deleteMany({ where: { version: { in: ['regions:t1', 'regions:t2', 'places-osm:t1', 'places-osm:t2', 'campuses:t1'] } } })
}
beforeEach(cleanImportData)
afterEach(cleanImportData)

describe('csv parser', () => {
  it('handles quotes, commas, newlines in fields and CRLF', () => {
    expect(parseCsv('a,b\r\n"x,1","he said ""hi""\nthere"\n')).toEqual([['a', 'b'], ['x,1', 'he said "hi"\nthere']])
  })
})

describe('importRegions', () => {
  it('loads a gzipped file, is idempotent on re-run and stores the polygon as jsonb', async () => {
    const f = writeCsv('region.t1.csv.gz', REGION_COLS, [region('98', 't1', { kind: 'provinsi' }), region('98.01', 't1'), region('98.01.01', 't1')])
    const first = await importRegions(prisma, { file: f })
    expect(first).toMatchObject({ dataset: 'regions', version: 't1', rows: 3, written: 3 })
    const again = await importRegions(prisma, { file: f })
    expect(again.written).toBe(3)
    expect(await prisma.region.count({ where: { code: { startsWith: '98' } } })).toBe(3)
    const row = await prisma.region.findUniqueOrThrow({ where: { code: '98.01.01' } })
    expect((row.polygon as { type: string }).type).toBe('MultiPolygon')
    expect(row.level).toBe(3)
  })

  it('--dry-run validates but writes nothing', async () => {
    const f = writeCsv('region.t1.csv', REGION_COLS, [region('98', 't1', { kind: 'provinsi' })])
    const res = await importRegions(prisma, { file: f, dryRun: true })
    expect(res.dryRun).toBe(true)
    expect(await prisma.region.count({ where: { code: '98' } })).toBe(0)
  })

  it('a bad row aborts the whole file before any write', async () => {
    const f = writeCsv('region.bad.csv', REGION_COLS, [region('98', 't1', { kind: 'provinsi' }), region('98.01', 't1', { lat: 48.8, lng: 2.3 })])
    await expect(importRegions(prisma, { file: f })).rejects.toBeInstanceOf(CatalogImportError)
    expect(await prisma.region.count({ where: { code: { startsWith: '98' } } })).toBe(0)
  })

  it('refuses a checksum mismatch', async () => {
    const f = writeCsv('region.sum.csv', REGION_COLS, [region('98', 't1', { kind: 'provinsi' })])
    await expect(importRegions(prisma, { file: f, expectedSha256: 'deadbeef' })).rejects.toThrow(/Checksum/)
    expect(await prisma.region.count({ where: { code: '98' } })).toBe(0)
  })

  it('a new version replaces the old rows; rollback restores the earlier file exactly', async () => {
    const v1 = writeCsv('region.t1.csv', REGION_COLS, [region('98', 't1', { kind: 'provinsi' }), region('98.01', 't1')])
    const v2 = writeCsv('region.t2.csv', REGION_COLS, [region('98', 't2', { kind: 'provinsi', name: 'Baru' }), region('98.02', 't2')])
    await importRegions(prisma, { file: v1 })
    const res2 = await importRegions(prisma, { file: v2 })
    expect(res2.removedStale).toBeGreaterThanOrEqual(1)
    expect((await prisma.region.findMany({ where: { code: { startsWith: '98' } }, orderBy: { code: 'asc' } })).map((r) => r.code)).toEqual(['98', '98.02'])
    expect((await prisma.catalogMeta.findUniqueOrThrow({ where: { version: 'regions:t2' } })).status).toBe('active')
    expect((await prisma.catalogMeta.findUniqueOrThrow({ where: { version: 'regions:t1' } })).status).toBe('superseded')
    await rollbackTo(prisma, 'regions', v1)
    expect((await prisma.region.findMany({ where: { code: { startsWith: '98' } }, orderBy: { code: 'asc' } })).map((r) => [r.code, r.name])).toEqual([['98', 'Wilayah 98'], ['98.01', 'Wilayah 98.01']])
    expect((await prisma.catalogMeta.findUniqueOrThrow({ where: { version: 'regions:t1' } })).status).toBe('active')
  })

  it('rejects a file with two data_versions', async () => {
    const f = writeCsv('region.mixed.csv', REGION_COLS, [region('98', 't1', { kind: 'provinsi' }), region('98.01', 't2')])
    await expect(importRegions(prisma, { file: f })).rejects.toThrow(/data_version/)
  })
})

describe('importPlaces', () => {
  it('loads quoted names, keeps one row per source id and removes rows a newer version dropped', async () => {
    const v1 = writeCsv('places.t1.csv.gz', PLACE_COLS, [place(1, 't1'), place(2, 't1')])
    const v2 = writeCsv('places.t2.csv.gz', PLACE_COLS, [place(2, 't2'), place(3, 't2')])
    await importPlaces(prisma, { file: v1 })
    expect((await prisma.placeCatalog.findUniqueOrThrow({ where: { id: 'poi-osm-nz1' } })).name).toBe('Warung, "Uji" 1')
    await importPlaces(prisma, { file: v1 })
    expect(await prisma.placeCatalog.count({ where: { id: { startsWith: 'poi-osm-nz' } } })).toBe(2)
    const res = await importPlaces(prisma, { file: v2 })
    expect(res.removedStale).toBe(1)
    expect((await prisma.placeCatalog.findMany({ where: { id: { startsWith: 'poi-osm-nz' } }, orderBy: { id: 'asc' } })).map((p) => p.id)).toEqual(['poi-osm-nz2', 'poi-osm-nz3'])
  })

  it('refuses an empty licence, a derived flag that disagrees with the source, an unknown category and a bad id', async () => {
    for (const over of [{ licence: '' }, { derived_from_osm: 0 }, { category: 'casino' }, { id: 'POI_1' }] as Record<string, string | number>[]) {
      const f = writeCsv('places.bad.csv', PLACE_COLS, [place(1, 't1', over)])
      await expect(importPlaces(prisma, { file: f })).rejects.toBeInstanceOf(CatalogImportError)
    }
    expect(await prisma.placeCatalog.count({ where: { id: { startsWith: 'poi-osm-nz' } } })).toBe(0)
  })

  it('the database itself refuses an OSM row that is not flagged as OSM-derived', async () => {
    await expect(prisma.placeCatalog.create({ data: { id: 'poi-osm-nz9', source: 'osm', sourceId: 'nz9', category: 'food', name: 'x', lat: -6, lng: 106, cell: '1:1', score: 3, licence: 'ODbL-1.0', attribution: 'a', derivedFromOsm: false, dataVersion: 't1' } })).rejects.toThrow()
  })
})

describe('two place sources', () => {
  it('keeps one active version per source and never touches the other source when one is replaced', async () => {
    const ovt = (n: number, v: string) => place(n, v, { id: `poi-ovt-z${n}`, source: 'overture', source_id: `uuid-${n}`, osm_type: '', osm_id: '', derived_from_osm: 0, licence: 'CDLA-Permissive-2.0', attribution: 'Overture Maps Foundation' })
    const osmFile = writeCsv('places.osm.t1.csv', PLACE_COLS, [place(1, 't1')])
    const ovtFile = writeCsv('places.ovt.t1.csv', PLACE_COLS, [ovt(7, 'o1'), ovt(8, 'o1')])
    const ovtNew = writeCsv('places.ovt.t2.csv', PLACE_COLS, [ovt(8, 'o2')])
    try {
      await importPlaces(prisma, { file: osmFile })
      await importPlaces(prisma, { file: ovtFile })
      const active = await prisma.catalogMeta.findMany({ where: { status: 'active', dataset: { startsWith: 'places' }, version: { in: ['places-osm:t1', 'places-overture:o1'] } } })
      expect(active.map((a) => a.version).sort()).toEqual(['places-osm:t1', 'places-overture:o1'])
      const res = await importPlaces(prisma, { file: ovtNew })
      expect(res.removedStale).toBe(1)
      expect(await prisma.placeCatalog.count({ where: { id: 'poi-osm-nz1' } })).toBe(1)
      expect((await prisma.catalogMeta.findUniqueOrThrow({ where: { version: 'places-osm:t1' } })).status).toBe('active')
      expect((await prisma.catalogMeta.findUniqueOrThrow({ where: { version: 'places-overture:o1' } })).status).toBe('superseded')
    } finally {
      await prisma.placeCatalog.deleteMany({ where: { id: { startsWith: 'poi-ovt-z' } } })
      await prisma.catalogMeta.deleteMany({ where: { version: { in: ['places-overture:o1', 'places-overture:o2'] } } })
    }
  })
})

describe('importCampuses', () => {
  const campus = (id: string, over: Record<string, string | number> = {}) => ({
    id, name: 'Universitas Impor', short_name: 'UI2', city: 'Kota', lat: -6.2, lng: 106.8, kind: 'universitas', parent_id: '', pddikti_id: '', osm_id: 'w1', wikidata_id: 'Q1', desa_code: '', gate_lat: '', gate_lng: '',
    coord_method: 'osm-centroid', verified_at: '', email_domains: 'impor.ac.id|mhs.impor.ac.id', website: '', aliases: 'Univ Impor|UI Dua', licence: 'ODbL-1.0', source: 'osm', data_version: 't1', ...over,
  })

  it('inserts new campuses with aliases and email domains split on |', async () => {
    const f = writeCsv('campus.t1.csv', CAMPUS_COLS, [campus('cmp-imp-w1')])
    await importCampuses(prisma, { file: f })
    const row = await prisma.campus.findUniqueOrThrow({ where: { id: 'cmp-imp-w1' } })
    expect(row.aliases).toEqual(['Univ Impor', 'UI Dua'])
    expect(row.emailDomains).toEqual(['impor.ac.id', 'mhs.impor.ac.id'])
    expect(row.dataVersion).toBe('t1')
    expect(row).toMatchObject({ source: 'osm', licence: 'ODbL-1.0', derivedFromOsm: true })
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM v_osm_derived_campuses WHERE id = 'cmp-imp-w1'`
    expect(n).toBe(1)
  })

  it('for an existing seeded id, fills catalogue fields but keeps name, coordinates and email domains', async () => {
    const seeded = await prisma.campus.findFirstOrThrow({ where: { dataVersion: null, NOT: { emailDomains: { isEmpty: true } } } })
    const f = writeCsv('campus.t1.csv', CAMPUS_COLS, [campus(seeded.id, { gate_lat: seeded.lat + 0.001, gate_lng: seeded.lng, coord_method: 'gate-osm', wikidata_id: 'Q99' })])
    try {
      await importCampuses(prisma, { file: f })
      const after = await prisma.campus.findUniqueOrThrow({ where: { id: seeded.id } })
      expect(after.name).toBe(seeded.name)
      expect(after.emailDomains).toEqual(seeded.emailDomains)
      expect(after.lat).toBe(seeded.lat)
      expect(after.wikidataId).toBe('Q99')
      expect(after.derivedFromOsm).toBe(false) // a seeded KoBo row stays KoBo's even when an OSM id is attached
      expect(after.gateLat).toBeCloseTo(seeded.lat + 0.001, 6)
    } finally {
      await prisma.campus.update({ where: { id: seeded.id }, data: { dataVersion: null, wikidataId: null, gateLat: null, gateLng: null, coordMethod: null, osmId: null, kind: null, aliases: [] } })
    }
  })

  it('refuses a half-filled gate', async () => {
    const f = writeCsv('campus.bad.csv', CAMPUS_COLS, [campus('cmp-imp-w2', { gate_lat: -6.2 })])
    await expect(importCampuses(prisma, { file: f })).rejects.toBeInstanceOf(CatalogImportError)
  })
})
