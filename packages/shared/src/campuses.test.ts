import { describe, expect, it } from 'vitest'
import { CAMPUS_CATALOG, branchById, groupOfBranch, normalizeCampusText, searchCampuses } from './campuses.ts'
import { FEATURED_CAMPUSES } from './featuredCampuses.ts'

const TRUSTED_CAMPUS_IDS = [
  'binus-syahdan', 'binus-anggrek', 'binus-kijang', 'ui-depok', 'itb-ganesha', 'ipb-dramaga', 'umn-gading-serpong', 'president-university',
  'undip-tembalang', 'ugm-bulaksumur', 'uns-kentingan', 'its-sukolilo', 'ub-malang', 'untirta-serang', 'unsil-tasikmalaya', 'unsoed-purwokerto',
  'uksw-salatiga', 'unej-jember',
]

const names = (query: string) => searchCampuses(query).map(({ group }) => group.shortName)
const ids = (query: string) => searchCampuses(query).map(({ branch }) => branch.id)

describe('featured campuses', () => {
  it('only lists branches that exist and have trusted coordinates', () => {
    for (const { id, label } of FEATURED_CAMPUSES) {
      const branch = branchById(id)
      const group = groupOfBranch(id)
      expect(branch).toBeDefined()
      expect(group).toBeDefined()
      expect(TRUSTED_CAMPUS_IDS).toContain(id)
      // Chip labels are short on purpose (e.g. "BINUS Syahdan"), so only require the group's short name.
      expect(label.startsWith(group!.shortName)).toBe(true)
    }
  })
})

describe('campus catalog and matching', () => {
  it('keeps unique ids and valid Java coordinates', () => {
    const groups = CAMPUS_CATALOG.map(({ id }) => id)
    const branches = CAMPUS_CATALOG.flatMap(({ branches }) => branches.map(({ id }) => id))
    expect(new Set(groups).size).toBe(groups.length)
    expect(new Set(branches).size).toBe(branches.length)
    const aliasOwners = new Map<string, string>()
    for (const group of CAMPUS_CATALOG) {
      expect(group.branches.length).toBeGreaterThan(0)
      expect(group.aliases.every((alias) => alias && alias === alias.toLowerCase())).toBe(true)
      for (const alias of group.aliases) {
        const key = normalizeCampusText(alias)
        expect(aliasOwners.has(key) && aliasOwners.get(key) !== group.id).toBe(false)
        aliasOwners.set(key, group.id)
      }
      for (const item of group.branches) {
        expect(Number.isFinite(item.lat) && item.lat >= -9 && item.lat <= -5).toBe(true)
        expect(Number.isFinite(item.lng) && item.lng >= 105 && item.lng <= 115).toBe(true)
        const boxes: Record<string, [number, number, number, number]> = {
          'DKI Jakarta': [-6.5, -5.8, 106.5, 107.2], Banten: [-7, -5.5, 105, 107],
          'Jawa Barat': [-8.2, -5.8, 106, 109.2], 'Jawa Tengah': [-8.5, -6, 108.3, 111.8],
          'DI Yogyakarta': [-8.4, -7.2, 109.8, 111], 'Jawa Timur': [-9, -6, 110, 115.5],
        }
        const [south, north, west, east] = boxes[item.province]
        expect(item.lat >= south && item.lat <= north && item.lng >= west && item.lng <= east).toBe(true)
      }
    }
    for (const id of ['binus-syahdan','binus-anggrek','binus-kijang','ui-depok','itb-ganesha','ipb-dramaga','umn-gading-serpong','president-university','undip-tembalang','ugm-bulaksumur','uns-kentingan','its-sukolilo','ub-malang','untirta-serang','unsil-tasikmalaya','unsoed-purwokerto','uksw-salatiga','unej-jember']) expect(branches).toContain(id)
  })

  it('matches campus names, abbreviations and branch locations', () => {
    expect(ids('binus')).toHaveLength(9)
    expect(names('binus').every((name) => name === 'BINUS')).toBe(true)
    expect(names('itb')).toEqual(['ITB'])
    expect(names('institut teknologi bandung')).toEqual(['ITB'])
    expect(names('bina nusantara').every((name) => name === 'BINUS')).toBe(true)
    expect(ids('ui')).toContain('ui-depok')
    expect(ids('ui')).toContain('ui-salemba')
    expect(names('ui')).not.toContain('Gunadarma')
    expect(names('ui')).not.toContain('Unsil')
    expect(names('its')).toEqual(['ITS'])
    expect(names('ub')).toEqual(['UB'])
    expect(ids('alam sutera')).toContain('binus-alam-sutera')
    expect(ids('tembalang')).toContain('undip-tembalang')
    expect(searchCampuses('teknologi').length).toBeLessThanOrEqual(8)
    expect(searchCampuses('teknologi').length).toBeGreaterThan(1)
    expect(searchCampuses('banten')).toEqual([])
    expect(searchCampuses('zzzz')).toEqual([])
    expect(names('Gadjah Mada')).toContain('UGM')
    expect(searchCampuses('ÃœNAIR').length).toBeGreaterThan(0)
    expect(searchCampuses('a')).toEqual([])
  })
})
