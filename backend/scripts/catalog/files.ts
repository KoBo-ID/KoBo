import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

/** RFC 4180 parser: quoted fields may hold commas, doubled quotes and newlines (region polygons do). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export interface CatalogFile {
  path: string
  sha256: string
  columns: string[]
  rows: Record<string, string>[]
}

/** Reads a .csv or .csv.gz. The checksum is of the file bytes as stored, so it can be compared with the one in `*.meta.json`. */
export function readCatalogFile(path: string): CatalogFile {
  const bytes = readFileSync(path)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const text = (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')
  const [head, ...body] = parseCsv(text)
  const columns = head ?? []
  const rows = body.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ''])))
  return { path, sha256, columns, rows }
}
