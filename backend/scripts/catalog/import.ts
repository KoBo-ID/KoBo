import { Prisma } from '../../src/generated/prisma/client.ts'
import type { PrismaClient } from '../../src/db/client.ts'
import { clearRegionCache } from '../../src/regionLookup.ts'
import { readCatalogFile } from './files.ts'
import type { CatalogFile } from './files.ts'
import { validateCampuses, validatePlaces, validateRegions } from './validate.ts'
import type { Problem } from './validate.ts'

export type Dataset = 'regions' | 'places' | 'campuses'

export interface ImportOptions {
  file: string
  dryRun?: boolean
  /** Rows per transaction. */
  batchSize?: number
  /** Expected sha256 of the file (from the *.meta.json next to it); a mismatch aborts before any write. */
  expectedSha256?: string
  log?: (line: string) => void
}

export interface ImportSummary {
  dataset: Dataset
  version: string
  rows: number
  written: number
  removedStale: number
  dryRun: boolean
  sha256: string
}

export class CatalogImportError extends Error {
  readonly problems: Problem[]
  constructor(message: string, problems: Problem[] = []) {
    super(message)
    this.name = 'CatalogImportError'
    this.problems = problems
  }
}

const nz = (s: string | undefined) => (s === undefined || s === '' ? null : s)
const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n))

function checkFile(file: CatalogFile, dataset: Dataset, expected?: string): string {
  if (expected && expected !== file.sha256) throw new CatalogImportError(`Checksum tidak cocok untuk ${file.path}: ${file.sha256} (diharapkan ${expected}).`)
  const problems = dataset === 'regions' ? validateRegions(file.columns, file.rows) : dataset === 'places' ? validatePlaces(file.columns, file.rows) : validateCampuses(file.columns, file.rows)
  if (problems.length) throw new CatalogImportError(`${problems.length} masalah validasi di ${file.path}; contoh: ${problems.slice(0, 3).map((p) => `baris ${p.row} ${p.field}: ${p.message}`).join(' | ')}`, problems)
  const versions = new Set(file.rows.map((r) => r.data_version))
  if (versions.size !== 1 || versions.has('')) throw new CatalogImportError(`${file.path} harus memuat tepat satu data_version (ditemukan: ${[...versions].join(', ') || 'kosong'}).`)
  return [...versions][0]!
}

async function markActive(prisma: PrismaClient, dataset: string, version: string, rows: number, sha256: string, summary: unknown): Promise<void> {
  await prisma.$transaction([
    prisma.catalogMeta.updateMany({ where: { dataset, status: 'active', NOT: { version: `${dataset}:${version}` } }, data: { status: 'superseded' } }),
    prisma.catalogMeta.upsert({
      where: { version: `${dataset}:${version}` },
      create: { version: `${dataset}:${version}`, dataset, status: 'active', rowCount: rows, checksum: sha256, sourceSummary: summary as Prisma.InputJsonValue },
      update: { status: 'active', rowCount: rows, checksum: sha256, loadedAt: new Date(), sourceSummary: summary as Prisma.InputJsonValue },
    }),
  ])
}

export async function importRegions(prisma: PrismaClient, opts: ImportOptions): Promise<ImportSummary> {
  const file = readCatalogFile(opts.file)
  const version = checkFile(file, 'regions', opts.expectedSha256)
  const summary: ImportSummary = { dataset: 'regions', version, rows: file.rows.length, written: 0, removedStale: 0, dryRun: !!opts.dryRun, sha256: file.sha256 }
  if (opts.dryRun) return summary
  for (const [i, batch] of chunk(file.rows, opts.batchSize ?? 500).entries()) {
    const col = (k: string) => batch.map((r) => nz(r[k]))
    await prisma.$executeRaw`
      INSERT INTO "Region" (code, level, name, kind, "parentCode", lat, lng, "minLat", "maxLat", "minLng", "maxLng", "postalCode", polygon, "polygonProvenance", "dataVersion")
      SELECT code, level::int, name, kind, "parentCode", lat::float8, lng::float8, "minLat"::float8, "maxLat"::float8, "minLng"::float8, "maxLng"::float8, "postalCode", polygon::jsonb, prov, ver
      FROM unnest(${col('code')}::text[], ${col('level')}::text[], ${col('name')}::text[], ${col('kind')}::text[], ${col('parent_code')}::text[], ${col('lat')}::text[], ${col('lng')}::text[],
                  ${col('min_lat')}::text[], ${col('max_lat')}::text[], ${col('min_lng')}::text[], ${col('max_lng')}::text[], ${col('postal_code')}::text[], ${col('polygon')}::text[],
                  ${col('polygon_provenance')}::text[], ${col('data_version')}::text[])
           AS t(code, level, name, kind, "parentCode", lat, lng, "minLat", "maxLat", "minLng", "maxLng", "postalCode", polygon, prov, ver)
      ON CONFLICT (code) DO UPDATE SET level = EXCLUDED.level, name = EXCLUDED.name, kind = EXCLUDED.kind, "parentCode" = EXCLUDED."parentCode", lat = EXCLUDED.lat, lng = EXCLUDED.lng,
        "minLat" = EXCLUDED."minLat", "maxLat" = EXCLUDED."maxLat", "minLng" = EXCLUDED."minLng", "maxLng" = EXCLUDED."maxLng", "postalCode" = EXCLUDED."postalCode",
        polygon = EXCLUDED.polygon, "polygonProvenance" = EXCLUDED."polygonProvenance", "dataVersion" = EXCLUDED."dataVersion"`
    summary.written += batch.length
    opts.log?.(`regions batch ${i + 1}: ${summary.written}/${summary.rows}`)
  }
  summary.removedStale = await prisma.$executeRaw`DELETE FROM "Region" WHERE "dataVersion" <> ${version}`
  await markActive(prisma, 'regions', version, summary.rows, file.sha256, { source: 'cahyadsn/wilayah + wilayah_boundaries', licence: 'MIT' })
  await prisma.$executeRaw`ANALYZE "Region"`
  clearRegionCache()
  return summary
}

export async function importPlaces(prisma: PrismaClient, opts: ImportOptions): Promise<ImportSummary> {
  const file = readCatalogFile(opts.file)
  const version = checkFile(file, 'places', opts.expectedSha256)
  const sources = [...new Set(file.rows.map((r) => r.source))]
  const summary: ImportSummary = { dataset: 'places', version, rows: file.rows.length, written: 0, removedStale: 0, dryRun: !!opts.dryRun, sha256: file.sha256 }
  if (opts.dryRun) return summary
  for (const [i, batch] of chunk(file.rows, opts.batchSize ?? 1000).entries()) {
    const col = (k: string) => batch.map((r) => nz(r[k]))
    await prisma.$executeRaw`
      INSERT INTO "PlaceCatalog" (id, source, "sourceId", category, subcategory, name, "nameAlt", brand, lat, lng, cell, "desaCode", "hoursRaw", website, "osmType", "osmId", score, licence, attribution,
                                  "derivedFromOsm", "firstSeen", "updatedAt", "isHidden", "dataVersion")
      SELECT id, source, sid, category, subcategory, name, alt, brand, lat::float8, lng::float8, cell, desa, hours, website, otype, oid::bigint, score::int, licence, attribution,
             (derived = '1'), first::timestamptz, upd::timestamptz, (hidden = '1'), ver
      FROM unnest(${col('id')}::text[], ${col('source')}::text[], ${col('source_id')}::text[], ${col('category')}::text[], ${col('subcategory')}::text[], ${col('name')}::text[], ${col('name_alt')}::text[],
                  ${col('brand')}::text[], ${col('lat')}::text[], ${col('lng')}::text[], ${col('cell')}::text[], ${col('desa_code')}::text[], ${col('hours_raw')}::text[], ${col('website')}::text[],
                  ${col('osm_type')}::text[], ${col('osm_id')}::text[], ${col('score')}::text[], ${col('licence')}::text[], ${col('attribution')}::text[], ${col('derived_from_osm')}::text[],
                  ${col('first_seen')}::text[], ${col('updated_at')}::text[], ${col('is_hidden')}::text[], ${col('data_version')}::text[])
           AS t(id, source, sid, category, subcategory, name, alt, brand, lat, lng, cell, desa, hours, website, otype, oid, score, licence, attribution, derived, first, upd, hidden, ver)
      ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, "sourceId" = EXCLUDED."sourceId", category = EXCLUDED.category, subcategory = EXCLUDED.subcategory, name = EXCLUDED.name,
        "nameAlt" = EXCLUDED."nameAlt", brand = EXCLUDED.brand, lat = EXCLUDED.lat, lng = EXCLUDED.lng, cell = EXCLUDED.cell, "desaCode" = EXCLUDED."desaCode", "hoursRaw" = EXCLUDED."hoursRaw",
        website = EXCLUDED.website, "osmType" = EXCLUDED."osmType", "osmId" = EXCLUDED."osmId", score = EXCLUDED.score, licence = EXCLUDED.licence, attribution = EXCLUDED.attribution,
        "derivedFromOsm" = EXCLUDED."derivedFromOsm", "firstSeen" = EXCLUDED."firstSeen", "updatedAt" = EXCLUDED."updatedAt", "isHidden" = EXCLUDED."isHidden", "dataVersion" = EXCLUDED."dataVersion"`
    summary.written += batch.length
    opts.log?.(`places batch ${i + 1}: ${summary.written}/${summary.rows}`)
  }
  // Rows from the same source(s) that this version no longer lists are gone upstream: remove them. Other sources are untouched (D3).
  summary.removedStale = await prisma.$executeRaw`DELETE FROM "PlaceCatalog" WHERE source = ANY(${sources}::text[]) AND "dataVersion" <> ${version}`
  // One CatalogMeta dataset per source (places-osm, places-overture): loading one source never supersedes another's active version.
  await markActive(prisma, `places-${sources.join('+')}`, version, summary.rows, file.sha256, { sources, licences: [...new Set(file.rows.map((r) => r.licence))] })
  await prisma.$executeRaw`ANALYZE "PlaceCatalog"`
  return summary
}

/**
 * Campuses: new rows are inserted whole; for an id that already exists (the hand-seeded campuses) only the catalogue
 * fields are filled in - name, short name, city, coordinates and emailDomains stay as they are, because ids and the
 * campus-email discount depend on them.
 */
export async function importCampuses(prisma: PrismaClient, opts: ImportOptions): Promise<ImportSummary> {
  const file = readCatalogFile(opts.file)
  const version = checkFile(file, 'campuses', opts.expectedSha256)
  const summary: ImportSummary = { dataset: 'campuses', version, rows: file.rows.length, written: 0, removedStale: 0, dryRun: !!opts.dryRun, sha256: file.sha256 }
  if (opts.dryRun) return summary
  for (const [i, batch] of chunk(file.rows, opts.batchSize ?? 500).entries()) {
    const col = (k: string) => batch.map((r) => nz(r[k]))
    await prisma.$executeRaw`
      INSERT INTO "Campus" (id, name, "shortName", city, lat, lng, "emailDomains", kind, "parentId", "pddiktiId", "osmId", "wikidataId", "desaCode", "gateLat", "gateLng", "coordMethod", "verifiedAt", website, aliases, "dataVersion", source, licence, "derivedFromOsm")
      SELECT id, name, short, city, lat::float8, lng::float8, string_to_array(NULLIF(email, ''), '|'), kind, parent, pddikti, osm, wikidata, desa, glat::float8, glng::float8, method, verified::timestamptz, website,
             COALESCE(string_to_array(NULLIF(alias, ''), '|'), ARRAY[]::text[]), ver, src, lic, (src = 'osm')
      FROM unnest(${col('id')}::text[], ${col('name')}::text[], ${col('short_name')}::text[], ${col('city')}::text[], ${col('lat')}::text[], ${col('lng')}::text[], ${col('email_domains')}::text[],
                  ${col('kind')}::text[], ${col('parent_id')}::text[], ${col('pddikti_id')}::text[], ${col('osm_id')}::text[], ${col('wikidata_id')}::text[], ${col('desa_code')}::text[],
                  ${col('gate_lat')}::text[], ${col('gate_lng')}::text[], ${col('coord_method')}::text[], ${col('verified_at')}::text[], ${col('website')}::text[], ${col('aliases')}::text[], ${col('data_version')}::text[], ${col('source')}::text[], ${col('licence')}::text[])
           AS t(id, name, short, city, lat, lng, email, kind, parent, pddikti, osm, wikidata, desa, glat, glng, method, verified, website, alias, ver, src, lic)
      ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, "parentId" = EXCLUDED."parentId", "pddiktiId" = EXCLUDED."pddiktiId", "osmId" = EXCLUDED."osmId", "wikidataId" = EXCLUDED."wikidataId",
        "desaCode" = EXCLUDED."desaCode", "gateLat" = EXCLUDED."gateLat", "gateLng" = EXCLUDED."gateLng", "coordMethod" = EXCLUDED."coordMethod", "verifiedAt" = EXCLUDED."verifiedAt",
        website = EXCLUDED.website, aliases = EXCLUDED.aliases, "dataVersion" = EXCLUDED."dataVersion"`
    summary.written += batch.length
    opts.log?.(`campuses batch ${i + 1}: ${summary.written}/${summary.rows}`)
  }
  await markActive(prisma, 'campuses', version, summary.rows, file.sha256, { licence: [...new Set(file.rows.map((r) => r.licence))] })
  await prisma.$executeRaw`ANALYZE "Campus"`
  return summary
}

/**
 * Rollback = load the file of an earlier version again. The files are kept next to each other as `<dataset>.<version>.csv.gz`;
 * the importer is idempotent and removes rows of any other version, so this restores the earlier state exactly.
 */
export async function rollbackTo(prisma: PrismaClient, dataset: Dataset, file: string, log?: (l: string) => void): Promise<ImportSummary> {
  const run = dataset === 'regions' ? importRegions : dataset === 'places' ? importPlaces : importCampuses
  return run(prisma, { file, log })
}
