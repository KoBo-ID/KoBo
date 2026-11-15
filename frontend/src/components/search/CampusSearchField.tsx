import React, { useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../lib/trpc'
import type { CampusBranch, CampusGroup, CampusSuggestion } from '@kobo/shared/campuses'

interface Props {
  value: string
  label: string
  placeholder: string
  onChange: (value: string) => void
  onSubmitText: (value: string) => void
  onPickCampus: (branch: CampusBranch) => void
  /** Province, regency, district or village from the region catalogue. Omit to leave regions out of the list. */
  onPickRegion?: (region: { code: string; name: string }) => void
  /** A campus outside the built-in list (catalogue campuses), picked by its point. */
  onPickPoint?: (point: { label: string; lat: number; lng: number }) => void
  onClear?: () => void
  className?: string
  style?: React.CSSProperties
}

const displayLabel = ({ group, branch }: CampusSuggestion) =>
  group.branches.length === 1 ? group.shortName : `${group.shortName} ${branch.label}`
const MAX_ROWS = 4
const MAX_LOCAL = 3
type Extra =
  | { type: 'point'; key: string; label: string; sub: string; lat: number; lng: number }
  | { type: 'region'; key: string; label: string; sub: string; code: string }
const KIND_LABEL: Record<string, string> = { provinsi: 'Provinsi', kabupaten: 'Kabupaten', kota: 'Kota', kecamatan: 'Kecamatan', kelurahan: 'Kelurahan', desa: 'Desa' }
const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')

export const CampusSearchField: React.FC<Props> = ({ value, label, placeholder, onChange, onSubmitText, onPickCampus, onPickRegion, onPickPoint, onClear, className, style }) => {
  const root = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const [catalog, setCatalog] = useState<CampusGroup[] | null>(null)
  const [results, setResults] = useState<CampusSuggestion[]>([])
  const [active, setActive] = useState(-1)
  const [closed, setClosed] = useState(false)
  const listId = `campus-options-${useId()}`
  const trpc = useTRPC()
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 200)
    return () => clearTimeout(t)
  }, [value])
  const remoteOn = debounced.length >= 2
  const regionsQ = useQuery({ ...trpc.region.search.queryOptions({ q: debounced, limit: 12 }), enabled: remoteOn && !!onPickRegion })
  const campusesQ = useQuery({ ...trpc.campus.search.queryOptions({ q: debounced, limit: 12 }), enabled: remoteOn && !!onPickPoint })
  const localNames = new Set(results.flatMap(({ group }) => [normalize(group.name), normalize(group.shortName)]))
  // Short list, biggest first: provinces and cities before districts (villages never), universities and institutes before small
  // schools, and names that start with what was typed before names that merely contain it.
  const q = normalize(debounced)
  const matchTier = (name: string, short?: string) => (normalize(name).startsWith(q) ? 0 : short && normalize(short).startsWith(q) ? 1 : normalize(name).split(' ').some((w) => w.startsWith(q)) ? 2 : 3)
  const SMALL_SCHOOL = /(stikes|stie|stmik|stia|stai|stkip|amik|akademi|akbid|akper|sekolah tinggi)/
  // Names that only contain the text mid-word ("Jatibanteng" for "banten") are noise.
  const regionRows = (regionsQ.data ?? []).filter((r) => r.level <= 3 && matchTier(r.name) < 3)
  const bigRegions = regionRows.filter((r) => r.level <= 2)
  const shownRegions = (bigRegions.length >= 2 ? bigRegions : regionRows).slice().sort((x, y) => matchTier(x.name) - matchTier(y.name) || x.level - y.level).slice(0, 4)
  const shownCampuses = (campusesQ.data ?? [])
    .filter((c) => !localNames.has(normalize(c.name)) && !localNames.has(normalize(c.shortName)))
    .map((c) => ({ c, rank: matchTier(c.name, c.shortName) * 2 + (SMALL_SCHOOL.test(normalize(c.name)) ? 1 : 0) }))
    .sort((x, y) => x.rank - y.rank)
    .slice(0, 3)
    .map(({ c }) => c)
  // At most four rows in all: the curated campuses first, then the rest split between regions and other campuses.
  const room = Math.max(0, MAX_ROWS - results.length)
  const nCampuses = Math.min(shownCampuses.length, room - Math.min(shownRegions.length, Math.ceil(room / 2)))
  const nRegions = Math.min(shownRegions.length, room - nCampuses)
  const extras: Extra[] = !remoteOn || debounced !== value.trim() ? [] : [
    ...(onPickRegion ? shownRegions.slice(0, nRegions).map((r): Extra => ({ type: 'region', key: `r-${r.code}`, label: r.name, sub: [KIND_LABEL[r.kind] ?? r.kind, r.path.split(', ').slice(1).join(', ')].filter(Boolean).join(' · '), code: r.code })) : []),
    ...(onPickPoint ? shownCampuses.slice(0, nCampuses).map((c): Extra => ({ type: 'point', key: `c-${c.id}`, label: c.name, sub: c.city, lat: c.lat, lng: c.lng })) : []),
  ]
  const total = results.length + extras.length

  useEffect(() => {
    if (!results.length && !extras.length) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setClosed(true)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [results.length, extras.length])

  const update = async (text: string) => {
    const currentRequest = ++request.current
    onChange(text)
    setActive(-1)
    setClosed(false)
    if (!text.trim()) { setResults([]); return }
    try {
      let nextCatalog = catalog
      if (!nextCatalog) {
        const mod = await import('@kobo/shared/campuses')
        nextCatalog = mod.CAMPUS_CATALOG
        setCatalog(nextCatalog)
      }
      if (currentRequest !== request.current) return
      const { searchCampuses } = await import('@kobo/shared/campuses')
      if (currentRequest === request.current) setResults(searchCampuses(text, nextCatalog).slice(0, MAX_LOCAL))
    } catch {
      if (currentRequest === request.current) setResults([])
    }
  }

  const open = !closed && total > 0
  const pick = (item: CampusSuggestion) => {
    setClosed(true)
    setResults([])
    onChange(displayLabel(item))
    onPickCampus(item.branch)
  }

  const pickExtra = (item: Extra) => {
    setClosed(true)
    setResults([])
    onChange(item.label)
    if (item.type === 'region') onPickRegion?.({ code: item.code, name: item.label })
    else onPickPoint?.({ label: item.label, lat: item.lat, lng: item.lng })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && open) { event.preventDefault(); setActive((n) => (n + 1) % total) }
    else if (event.key === 'ArrowUp' && open) { event.preventDefault(); setActive((n) => (n <= 0 ? total - 1 : n - 1)) }
    else if (event.key === 'Escape') { setClosed(true); setActive(-1) }
    else if (event.key === 'Tab') setClosed(true)
    else if (event.key === 'Enter') {
      const exactSingle = results.find(({ group }) => group.branches.length === 1 && group.aliases.some((alias) => normalize(alias) === normalize(value)))
      if (active >= 0 && results[active]) { event.preventDefault(); pick(results[active]) }
      else if (active >= results.length && extras[active - results.length]) { event.preventDefault(); pickExtra(extras[active - results.length]!) }
      else if (exactSingle) { event.preventDefault(); pick(exactSingle) }
      else if (open && results.some(({ group }) => group.branches.length > 1 && group.aliases.some((alias) => normalize(alias) === normalize(value)))) { event.preventDefault(); setActive(0) }
      else { event.preventDefault(); onSubmitText(value) }
    }
  }

  const groupRuns: Array<{ group: CampusGroup; items: Array<{ item: CampusSuggestion; index: number }> }> = []
  results.forEach((item, index) => {
    let run = groupRuns[groupRuns.length - 1]
    if (!run || run.group.id !== item.group.id) { run = { group: item.group, items: [] }; groupRuns.push(run) }
    run.items.push({ item, index })
  })

  return <div className={`campus-search ${className ?? ''}`} ref={root} style={style}>
    <div className="kobo-searchfield">
      <Search size={18} aria-hidden="true" />
      <input
        type="text" value={value} onChange={(event) => { void update(event.target.value) }}
        onKeyDown={handleKeyDown} onFocus={() => { if (value && total) setClosed(false) }}
        onBlur={() => setClosed(true)} autoComplete="off" placeholder={placeholder}
        role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId}
        aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      />
      {!!value && <button type="button" className="kobo-searchfield__clear" onClick={() => onClear ? onClear() : void update('')} aria-label="Bersihkan pencarian"><X size={15} /></button>}
    </div>
    {open && <div className="campus-search__list" id={listId} role="listbox">
      {groupRuns.map(({ group, items }) => <div role="group" aria-label={group.name} key={group.id}>
        {group.branches.length > 1 && <div className="campus-search__heading">{group.shortName}</div>}
        {items.map(({ item, index }) => <div
          id={`${listId}-${index}`} role="option" aria-selected={index === active} key={item.branch.id}
          className="campus-search__option" onPointerDown={(event) => event.preventDefault()}
          onClick={() => pick(item)}
        >
          <span>{displayLabel(item)}</span><small>{item.branch.city}, {item.branch.province}</small>
        </div>)}
      </div>)}
      {(['region', 'point'] as const).map((type) => {
        const rows = extras.map((item, i) => ({ item, index: results.length + i })).filter(({ item }) => item.type === type)
        if (!rows.length) return null
        return <div role="group" aria-label={type === 'point' ? 'Kampus lainnya' : 'Wilayah'} key={type}>
          <div className="campus-search__heading">{type === 'point' ? 'Kampus lainnya' : 'Wilayah'}</div>
          {rows.map(({ item, index }) => <div
            id={`${listId}-${index}`} role="option" aria-selected={index === active} key={item.key}
            className="campus-search__option" onPointerDown={(event) => event.preventDefault()}
            onClick={() => pickExtra(item)}
          >
            <span>{item.label}</span><small>{item.sub}</small>
          </div>)}
        </div>
      })}
    </div>}
  </div>
}
