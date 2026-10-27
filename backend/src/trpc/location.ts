import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { campusSearchInput, regionChildrenInput, regionLookupInput, regionSearchInput } from '@kobo/shared/schemas'
import { parseList } from '../env.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { normalizeRegionName } from '../regionLookup.ts'
import { authedProcedure, publicProcedure, router } from './trpc.ts'

export interface RegionView {
  code: string
  level: number
  name: string
  kind: string
  parentCode: string | null
  lat: number
  lng: number
}

const regionSelect = { code: true, level: true, name: true, kind: true, parentCode: true, lat: true, lng: true } as const

/** Escapes LIKE wildcards so a typed "%" or "_" is literal. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export const regionRouter = router({
  /** Provinces when no parent is given, else the next level down. Public and cacheable. */
  children: publicProcedure.input(regionChildrenInput).query(async ({ ctx, input }): Promise<RegionView[]> => {
    return ctx.prisma.region.findMany({
      where: input.parentCode ? { parentCode: input.parentCode } : { level: 1 },
      select: regionSelect,
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
      take: 600,
    })
  }),

  /** One region with its chain of ancestors (for breadcrumbs and "kos di <kecamatan>" pages). */
  get: publicProcedure.input(regionLookupInput).query(async ({ ctx, input }): Promise<{ region: RegionView; ancestors: RegionView[] } | null> => {
    const parts = input.code.split('.')
    const chain = parts.map((_, i) => parts.slice(0, i + 1).join('.'))
    const rows = await ctx.prisma.region.findMany({ where: { code: { in: chain } }, select: regionSelect })
    const region = rows.find((r) => r.code === input.code)
    if (!region) return null
    return { region, ancestors: chain.slice(0, -1).map((c) => rows.find((r) => r.code === c)).filter((r): r is RegionView => !!r) }
  }),

  /** The polygon and bbox of one province, regency or district, for the map outline. Fetched lazily, only by the map. */
  outline: publicProcedure.input(regionLookupInput).query(async ({ ctx, input }) => {
    const r = await ctx.prisma.region.findUnique({ where: { code: input.code }, select: { code: true, name: true, kind: true, lat: true, lng: true, minLat: true, maxLat: true, minLng: true, maxLng: true, polygon: true } })
    if (!r || r.minLat === null || r.maxLat === null || r.minLng === null || r.maxLng === null) return null
    return {
      code: r.code,
      name: r.name,
      kind: r.kind,
      center: { lat: r.lat, lng: r.lng },
      bbox: { minLat: r.minLat, maxLat: r.maxLat, minLng: r.minLng, maxLng: r.maxLng },
      polygon: (r.polygon as { type: 'MultiPolygon'; coordinates: number[][][][] } | null) ?? null,
    }
  }),

  /** Typeahead by name with the administrative prefix tolerated ("kota jakarta barat", "kec. kelapa dua"). */
  search: publicProcedure.input(regionSearchInput).query(async ({ ctx, input }): Promise<(RegionView & { path: string })[]> => {
    const norm = normalizeRegionName(input.q)
    if (norm.length < 2) return []
    const pattern = `%${likeEscape(norm)}%`
    const stripped = Prisma.sql`regexp_replace(lower(name), '^(kota administrasi|kabupaten administrasi|kota adm\.?|kabupaten|kab\.?|kota|kecamatan|kec\.?|kelurahan|kel\.?|desa) ', '')`
    const rows = await ctx.prisma.$queryRaw<(RegionView & { rank: number })[]>(Prisma.sql`
      SELECT code, level, name, kind, "parentCode", lat, lng,
             CASE WHEN lower(name) = ${input.q.toLowerCase()} THEN 0 WHEN ${stripped} = ${norm} THEN 1 WHEN ${stripped} LIKE ${`${likeEscape(norm)}%`} THEN 2 ELSE 3 END AS rank
      FROM "Region"
      WHERE lower(name) LIKE ${pattern} ${input.level ? Prisma.sql`AND level = ${input.level}` : Prisma.empty}
      ORDER BY rank, level, name LIMIT ${input.limit}`)
    const parentCodes = [...new Set(rows.map((r) => r.parentCode).filter((c): c is string => !!c))]
    const parents = await ctx.prisma.region.findMany({ where: { code: { in: parentCodes } }, select: { code: true, name: true, parentCode: true } })
    const grand = await ctx.prisma.region.findMany({ where: { code: { in: [...new Set(parents.map((p) => p.parentCode).filter((c): c is string => !!c))] } }, select: { code: true, name: true } })
    return rows.map(({ rank: _rank, ...r }) => {
      const p = parents.find((x) => x.code === r.parentCode)
      const g = grand.find((x) => x.code === p?.parentCode)
      return { ...r, path: [r.name, p?.name, g?.name].filter(Boolean).join(', ') }
    })
  }),
})

export interface CampusView {
  id: string
  name: string
  shortName: string
  city: string
  lat: number
  lng: number
  kind: string | null
}

export const campusRouter = router({
  /** Nationwide campus typeahead from our own tables: ILIKE prefix on name and short name, plus aliases. */
  search: publicProcedure.input(campusSearchInput).query(async ({ ctx, input }): Promise<CampusView[]> => {
    const q = likeEscape(input.q.toLowerCase())
    return ctx.prisma.$queryRaw<CampusView[]>(Prisma.sql`
      SELECT id, name, "shortName", city, lat, lng, kind
      FROM "Campus"
      WHERE lower(name) LIKE ${`%${q}%`} ESCAPE '\\' OR lower("shortName") LIKE ${`${q}%`} ESCAPE '\\' OR lower(city) = ${input.q.toLowerCase()}
         OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE lower(a) LIKE ${`${q}%`} ESCAPE '\\')
      ORDER BY (lower("shortName") = ${input.q.toLowerCase()}) DESC, (lower(name) LIKE ${`${q}%`} ESCAPE '\\') DESC, name
      LIMIT ${input.limit}`)
  }),
})

export interface CatalogStatus {
  datasets: { dataset: string; version: string; status: string; rowCount: number; loadedAt: string }[]
  counts: { regions: number; places: number; campuses: number }
}

/** Operators only: the emails in CATALOG_ADMIN_EMAILS. Not public, the catalogue is never exposed as a dump. */
export const catalogRouter = router({
  status: authedProcedure.query(async ({ ctx }): Promise<CatalogStatus> => {
    const allowed = parseList(process.env.CATALOG_ADMIN_EMAILS).map((e) => e.toLowerCase())
    const email = (await ctx.prisma.user.findUnique({ where: { id: ctx.user.id }, select: { email: true } }))?.email.toLowerCase()
    if (!email || !allowed.includes(email)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Hanya admin KoBo yang dapat melihat status katalog.' })
    const [meta, regions, places, campuses] = await Promise.all([
      ctx.prisma.catalogMeta.findMany({ orderBy: { loadedAt: 'desc' }, take: 20 }),
      ctx.prisma.region.count(),
      ctx.prisma.placeCatalog.count(),
      ctx.prisma.campus.count(),
    ])
    return {
      datasets: meta.map((m) => ({ dataset: m.dataset, version: m.version, status: m.status, rowCount: m.rowCount, loadedAt: m.loadedAt.toISOString() })),
      counts: { regions, places, campuses },
    }
  }),

  /** Static for the /lisensi page: the sources the catalogue is built from and how each must be credited. */
  licenses: publicProcedure.query(() => LICENSES),
})

export const LICENSES = {
  sources: [
    { id: 'osm', name: 'OpenStreetMap', licence: 'ODbL 1.0', attribution: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright', use: 'Tempat di sekitar kos, halte, stasiun' },
    { id: 'overture', name: 'Overture Maps Places', licence: 'CDLA-Permissive-2.0 (Meta, Microsoft, Uberall, PinMeTo, DAC), Apache-2.0 (Foursquare), CC0-1.0 (AllThePlaces)', attribution: 'Overture Maps Foundation', href: 'https://docs.overturemaps.org/attribution/', use: 'Warung, kafe, laundry, fotokopi dan tempat lain (rilis 2026-10-21.0)' },
    { id: 'foursquare', name: 'Foursquare Open Source Places (via Overture)', licence: 'Apache-2.0', attribution: 'Copyright 2024 Foursquare Labs, Inc.', href: 'https://docs.foursquare.com/data-products/docs/access-fsq-os-places', use: 'Sebagian data tempat' },
    { id: 'wilayah', name: 'cahyadsn/wilayah', licence: 'MIT', attribution: 'Kode wilayah: cahyadsn/wilayah (MIT)', href: 'https://github.com/cahyadsn/wilayah', use: 'Kode dan nama provinsi sampai desa/kelurahan' },
    { id: 'wilayah_boundaries', name: 'cahyadsn/wilayah_boundaries', licence: 'MIT', attribution: 'Batas wilayah: cahyadsn/wilayah_boundaries (MIT)', href: 'https://github.com/cahyadsn/wilayah_boundaries', use: 'Batas kecamatan dan titik pusat desa (sederhana, bukan batas resmi)' },
  ],
  notes: ['Jarak adalah garis lurus, bukan rute. Waktu tempuh adalah perkiraan.', 'Data tempat dapat tidak lengkap; pemilik kos dapat menambah atau menyembunyikan tempat.'],
} as const

// Exported for the router tests (the zod shape of a path segment).
export const regionCodeSchema = z.string().regex(/^\d{2}(\.\d{2}){0,2}(\.\d{4})?$/)
