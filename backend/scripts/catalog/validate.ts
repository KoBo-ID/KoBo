// The validate.py rules (notes/data-gathering/validate.py) re-implemented, so a bad file is refused before it touches the database.

export const ID_RE = /^(reg|cmp|poi)-[a-z0-9]+-[a-z0-9]+$/
export const REGION_CODE_RE = /^\d{2}(\.\d{2}){0,2}(\.\d{4})?$/
const LAT = [-11.5, 6.5] as const
const LNG = [94.5, 141.5] as const

export const REGION_COLUMNS = ['code', 'level', 'name', 'kind', 'parent_code', 'lat', 'lng', 'min_lat', 'max_lat', 'min_lng', 'max_lng', 'postal_code', 'polygon', 'polygon_provenance', 'data_version', 'source', 'licence']
export const PLACE_COLUMNS = ['id', 'source', 'source_id', 'category', 'subcategory', 'name', 'name_alt', 'brand', 'lat', 'lng', 'cell', 'desa_code', 'hours_raw', 'website', 'osm_type', 'osm_id', 'score', 'licence', 'attribution', 'derived_from_osm', 'first_seen', 'updated_at', 'is_hidden', 'data_version']
export const CAMPUS_COLUMNS = ['id', 'name', 'short_name', 'city', 'lat', 'lng', 'kind', 'parent_id', 'pddikti_id', 'osm_id', 'wikidata_id', 'desa_code', 'gate_lat', 'gate_lng', 'coord_method', 'verified_at', 'email_domains', 'website', 'aliases', 'licence', 'source', 'data_version']
export const PLACE_CATEGORIES_OK = new Set(['food', 'minimarket', 'laundry', 'print', 'atm', 'pharmacy', 'clinic', 'hospital', 'worship', 'gym', 'cafe', 'transit', 'pasar'])

export interface Problem {
  row: number
  field: string
  message: string
}

const inIndonesia = (lat: number, lng: number) => lat >= LAT[0] && lat <= LAT[1] && lng >= LNG[0] && lng <= LNG[1]
const num = (s: string) => (s.trim() === '' ? NaN : Number(s))

function missingColumns(have: string[], need: string[]): Problem[] {
  return need.filter((c) => !have.includes(c)).map((c) => ({ row: 0, field: c, message: 'kolom wajib tidak ada' }))
}

export function validateRegions(columns: string[], rows: Record<string, string>[]): Problem[] {
  const problems = missingColumns(columns, REGION_COLUMNS)
  if (problems.length) return problems
  const seen = new Set<string>()
  rows.forEach((r, i) => {
    const at = i + 2
    if (!REGION_CODE_RE.test(r.code!)) problems.push({ row: at, field: 'code', message: `kode tidak valid: ${r.code}` })
    if (seen.has(r.code!)) problems.push({ row: at, field: 'code', message: `kode ganda: ${r.code}` })
    seen.add(r.code!)
    if (Number(r.level) !== r.code!.split('.').length) problems.push({ row: at, field: 'level', message: 'level tidak cocok dengan kode' })
    if (!r.name) problems.push({ row: at, field: 'name', message: 'nama kosong' })
    if (!r.licence) problems.push({ row: at, field: 'licence', message: 'lisensi kosong' })
    if (!inIndonesia(num(r.lat!), num(r.lng!))) problems.push({ row: at, field: 'lat/lng', message: 'koordinat di luar Indonesia' })
    if (r.polygon) {
      try {
        const g = JSON.parse(r.polygon) as { type?: string; coordinates?: unknown }
        if (g.type !== 'MultiPolygon' || !Array.isArray(g.coordinates)) problems.push({ row: at, field: 'polygon', message: 'bukan MultiPolygon' })
      } catch {
        problems.push({ row: at, field: 'polygon', message: 'JSON rusak' })
      }
    }
  })
  return problems
}

export function validatePlaces(columns: string[], rows: Record<string, string>[]): Problem[] {
  const problems = missingColumns(columns, PLACE_COLUMNS)
  if (problems.length) return problems
  const seen = new Set<string>()
  rows.forEach((r, i) => {
    const at = i + 2
    if (!ID_RE.test(r.id!)) problems.push({ row: at, field: 'id', message: `id tidak valid: ${r.id}` })
    if (seen.has(r.id!)) problems.push({ row: at, field: 'id', message: `id ganda: ${r.id}` })
    seen.add(r.id!)
    if (!PLACE_CATEGORIES_OK.has(r.category!)) problems.push({ row: at, field: 'category', message: `kategori tidak dikenal: ${r.category}` })
    if (!r.name) problems.push({ row: at, field: 'name', message: 'nama kosong' })
    if (!r.licence) problems.push({ row: at, field: 'licence', message: 'lisensi kosong' })
    if (!r.attribution) problems.push({ row: at, field: 'attribution', message: 'atribusi kosong' })
    if (!inIndonesia(num(r.lat!), num(r.lng!))) problems.push({ row: at, field: 'lat/lng', message: 'koordinat di luar Indonesia' })
    if (!Number.isInteger(num(r.score!))) problems.push({ row: at, field: 'score', message: 'skor bukan bilangan bulat' })
    const osm = r.source === 'osm'
    if ((r.derived_from_osm === '1') !== osm) problems.push({ row: at, field: 'derived_from_osm', message: 'derived_from_osm tidak konsisten dengan source' })
    if (osm && !/^[nwr]\d+$/.test(r.source_id!)) problems.push({ row: at, field: 'source_id', message: 'source_id OSM tidak valid' })
  })
  return problems
}

export function validateCampuses(columns: string[], rows: Record<string, string>[]): Problem[] {
  const problems = missingColumns(columns, CAMPUS_COLUMNS)
  if (problems.length) return problems
  const seen = new Set<string>()
  rows.forEach((r, i) => {
    const at = i + 2
    if (!r.id) problems.push({ row: at, field: 'id', message: 'id kosong' })
    if (seen.has(r.id!)) problems.push({ row: at, field: 'id', message: `id ganda: ${r.id}` })
    seen.add(r.id!)
    if (!r.name) problems.push({ row: at, field: 'name', message: 'nama kosong' })
    if (!r.licence) problems.push({ row: at, field: 'licence', message: 'lisensi kosong' })
    if (!r.source) problems.push({ row: at, field: 'source', message: 'source kosong' })
    if (r.source === 'osm' && !r.licence!.startsWith('ODbL')) problems.push({ row: at, field: 'licence', message: 'baris OSM harus berlisensi ODbL' })
    if (!inIndonesia(num(r.lat!), num(r.lng!))) problems.push({ row: at, field: 'lat/lng', message: 'koordinat di luar Indonesia' })
    if ((r.gate_lat === '') !== (r.gate_lng === '')) problems.push({ row: at, field: 'gate', message: 'gate_lat dan gate_lng harus berpasangan' })
    if (r.gate_lat && !inIndonesia(num(r.gate_lat), num(r.gate_lng!))) problems.push({ row: at, field: 'gate', message: 'gerbang di luar Indonesia' })
  })
  return problems
}
