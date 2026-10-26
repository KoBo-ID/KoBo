/**
 * Campuses shown as quick links on Home. Kept apart from campuses.ts on purpose: Home is not lazy, and
 * importing the catalog would put all of it in the initial chunk. Only branches with trusted coordinates
 * belong here; campuses.test.ts checks every id and label against the catalog.
 */
export const FEATURED_CAMPUSES = [
  { id: 'binus-syahdan', label: 'BINUS Syahdan' },
  { id: 'ui-depok', label: 'UI Depok' },
  { id: 'umn-gading-serpong', label: 'UMN' },
  { id: 'itb-ganesha', label: 'ITB' },
  { id: 'ugm-bulaksumur', label: 'UGM' },
] as const
