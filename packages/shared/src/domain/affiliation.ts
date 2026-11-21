/**
 * True when the verified campus, or the campus it is a branch of, is in the affiliated set ("Diskon Kampus Mitra").
 * A student verified at a branch campus counts when the parent is affiliated.
 */
export function isAffiliatedCampus(campus: { id: string; parentId: string | null } | null, affiliated: ReadonlySet<string>): boolean {
  if (!campus) return false
  return affiliated.has(campus.id) || (campus.parentId !== null && affiliated.has(campus.parentId))
}
