import { describe, expect, it } from 'vitest'
import { PLACE_COLUMNS, validatePlaces } from '../../scripts/catalog/validate.js'

describe('catalogue police validation', () => {
  const row: Record<string, string> = {
    ...Object.fromEntries(PLACE_COLUMNS.map((column) => [column, ''])),
    id: 'poi-osm-n123', source: 'osm', source_id: 'n123', category: 'police',
    name: 'Kantor Polisi', lat: '-6.2', lng: '106.8', score: '3',
    licence: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', derived_from_osm: '1',
  }

  it('accepts police and rejects an unknown category', () => {
    expect(validatePlaces(PLACE_COLUMNS, [row])).toEqual([])
    expect(validatePlaces(PLACE_COLUMNS, [{ ...row, category: 'unknown-x' }]))
      .toEqual([{ row: 2, field: 'category', message: 'kategori tidak dikenal: unknown-x' }])
  })
})
