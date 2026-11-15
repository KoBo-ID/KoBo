import React, { useId, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { FACILITY_GROUPS, FACILITY_PRESETS, scopeOfGroup } from '@kobo/shared/facilities';
import type { FacilityGroup, FacilityItem, FacilityScope } from '@kobo/shared/facilities';
import { Button } from '../ui/Button';

interface FacilityEditorProps {
  scope: FacilityScope;
  value: FacilityItem[];
  /** Receives the whole list (both scopes); this editor only touches the items of its own scope. */
  onChange: (next: FacilityItem[]) => void;
}

const sameItem = (a: FacilityItem, label: string, scope: FacilityScope) => a.scope === scope && a.label.toLowerCase() === label.toLowerCase();

/**
 * Facilities of one scope: tap a suggestion to list it, add your own, and say for each whether it is included or paid, with a
 * short note ("100 Mbps", "15 motor"). Nothing is pre-selected: an empty list stays empty until the owner chooses.
 */
export const FacilityEditor: React.FC<FacilityEditorProps> = ({ scope, value, onChange }) => {
  const baseId = useId();
  const groups = FACILITY_GROUPS.filter((g) => g.scope === scope && g.id !== 'LAINNYA');
  const mine = value.filter((i) => i.scope === scope);
  const [custom, setCustom] = useState('');
  const [customGroup, setCustomGroup] = useState<FacilityGroup>(scope === 'KAMAR' ? 'KAMAR' : 'LAINNYA');

  const add = (label: string, group: FacilityGroup) => {
    const clean = label.trim();
    if (!clean || value.some((i) => sameItem(i, clean, scope))) return;
    onChange([...value, { label: clean, scope: scopeOfGroup(group), group, status: 'INCLUDED' }]);
  };
  const remove = (label: string) => onChange(value.filter((i) => !sameItem(i, label, scope)));
  const patch = (label: string, change: Partial<FacilityItem>) => onChange(value.map((i) => (sameItem(i, label, scope) ? { ...i, ...change } : i)));

  return (
    <div className="okf-facilities">
      {groups.map((g) => {
        const presets = FACILITY_PRESETS.filter((p) => p.group === g.id);
        return (
          <div key={g.id} role="group" aria-labelledby={`${baseId}-${g.id}`} className="okf-facilities__group">
            {scope === 'GEDUNG' && <p id={`${baseId}-${g.id}`} className="okf-facilities__title">{g.label}</p>}
            <div className="okf-chips">
              {presets.map((p) => {
                const on = mine.some((i) => sameItem(i, p.label, scope));
                return (
                  <button key={p.label} type="button" className="okf-chip" aria-pressed={on} onClick={() => (on ? remove(p.label) : add(p.label, p.group))}>
                    {on && <Check size={13} aria-hidden="true" />}
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="okf-facilities__custom">
        <label htmlFor={`${baseId}-custom`} className="okf-label">Tambah fasilitas lain</label>
        <div className="okf-facilities__customrow">
          <input
            id={`${baseId}-custom`}
            className="okf-input"
            value={custom}
            maxLength={60}
            placeholder={scope === 'KAMAR' ? 'Contoh: Jendela arah luar' : 'Contoh: Mushola'}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(custom, customGroup);
                setCustom('');
              }
            }}
          />
          {scope === 'GEDUNG' && (
            <select className="okf-input" aria-label="Kelompok fasilitas" value={customGroup} onChange={(e) => setCustomGroup(e.target.value as FacilityGroup)}>
              {FACILITY_GROUPS.filter((g) => g.scope === 'GEDUNG').map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          )}
          <Button type="button" variant="outline" size="sm" icon={<Plus size={14} />} disabled={!custom.trim()} onClick={() => { add(custom, customGroup); setCustom(''); }}>
            Tambah
          </Button>
        </div>
      </div>

      {mine.length > 0 && (
        <ul className="okf-facilities__list" aria-label={`Fasilitas ${scope === 'KAMAR' ? 'kamar' : 'gedung'} yang dipilih`}>
          {mine.map((item) => (
            <li key={item.label} className="okf-facrow">
              <span className="okf-facrow__label">{item.label}</span>
              <select className="okf-input" aria-label={`Status ${item.label}`} value={item.status} onChange={(e) => patch(item.label, { status: e.target.value as FacilityItem['status'], ...(e.target.value === 'INCLUDED' ? { fee: null } : {}) })}>
                <option value="INCLUDED">Termasuk sewa</option>
                <option value="PAID">Berbayar</option>
              </select>
              <input
                className="okf-input"
                aria-label={`Biaya ${item.label} (Rp)`}
                type="number"
                inputMode="numeric"
                min={0}
                max={10000000}
                placeholder={item.status === 'PAID' ? 'Biaya (Rp)' : '-'}
                disabled={item.status !== 'PAID'}
                value={item.fee ?? ''}
                onChange={(e) => patch(item.label, { fee: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <input className="okf-input" aria-label={`Catatan ${item.label}`} maxLength={80} placeholder="Catatan, mis. 100 Mbps" value={item.note ?? ''} onChange={(e) => patch(item.label, { note: e.target.value })} />
              <button type="button" className="okf-facrow__remove" aria-label={`Hapus ${item.label}`} onClick={() => remove(item.label)}>
                <X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
