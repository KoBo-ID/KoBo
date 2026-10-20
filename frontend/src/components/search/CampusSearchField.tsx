import React, { useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { CampusBranch, CampusGroup, CampusSuggestion } from '@kobo/shared/campuses'

interface Props {
  value: string
  label: string
  placeholder: string
  onChange: (value: string) => void
  onSubmitText: (value: string) => void
  onPickCampus: (branch: CampusBranch) => void
  onClear?: () => void
  className?: string
  style?: React.CSSProperties
}

const displayLabel = ({ group, branch }: CampusSuggestion) =>
  group.branches.length === 1 ? group.shortName : `${group.shortName} ${branch.label}`
const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')

export const CampusSearchField: React.FC<Props> = ({ value, label, placeholder, onChange, onSubmitText, onPickCampus, onClear, className, style }) => {
  const root = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const [catalog, setCatalog] = useState<CampusGroup[] | null>(null)
  const [results, setResults] = useState<CampusSuggestion[]>([])
  const [active, setActive] = useState(-1)
  const [closed, setClosed] = useState(false)
  const listId = `campus-options-${useId()}`

  useEffect(() => {
    if (!results.length) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setClosed(true)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [results.length])

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
      if (currentRequest === request.current) setResults(searchCampuses(text, nextCatalog))
    } catch {
      if (currentRequest === request.current) setResults([])
    }
  }

  const open = !closed && results.length > 0
  const pick = (item: CampusSuggestion) => {
    setClosed(true)
    setResults([])
    onChange(displayLabel(item))
    onPickCampus(item.branch)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && open) { event.preventDefault(); setActive((n) => (n + 1) % results.length) }
    else if (event.key === 'ArrowUp' && open) { event.preventDefault(); setActive((n) => (n <= 0 ? results.length - 1 : n - 1)) }
    else if (event.key === 'Escape') { setClosed(true); setActive(-1) }
    else if (event.key === 'Tab') setClosed(true)
    else if (event.key === 'Enter') {
      const exactSingle = results.find(({ group }) => group.branches.length === 1 && group.aliases.some((alias) => normalize(alias) === normalize(value)))
      if (active >= 0 && results[active]) { event.preventDefault(); pick(results[active]) }
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
        onKeyDown={handleKeyDown} onFocus={() => { if (value && results.length) setClosed(false) }}
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
    </div>}
  </div>
}
