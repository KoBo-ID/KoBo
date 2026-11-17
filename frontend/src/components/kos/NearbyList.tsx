import React, { useState } from 'react';
import { Banknote, Bike, Bus, Church, Coffee, Cross, Dumbbell, Footprints, GraduationCap, Hospital, MapPin, Navigation, Printer, Siren, ShoppingBasket, Star, Stethoscope, Store, Utensils, WashingMachine, type LucideIcon } from 'lucide-react';
import type { NearbyItem, NearbyView } from '../../../../backend/src/trpc/router';
import type { PlaceCategoryId } from '@kobo/shared/places';

const SHOWN_ROWS = 5;

const directionsUrl = (item: Pick<NearbyItem, 'lat' | 'lng'>) => `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`;

/** One icon tab per category, so nothing hides behind a catch-all. The label shows on hover, on keyboard focus and on the open tab. */
const ICONS: Record<PlaceCategoryId, LucideIcon> = {
  campus: GraduationCap, food: Utensils, minimarket: ShoppingBasket, laundry: WashingMachine, print: Printer, atm: Banknote, pharmacy: Cross,
  clinic: Stethoscope, hospital: Hospital, police: Siren, worship: Church, gym: Dumbbell, cafe: Coffee, transit: Bus, pasar: Store,
};

/** "Sorotan": the nearest few places of the categories a student checks first. `any` lists categories that compete for the same slots. */
const HIGHLIGHTS: { any: PlaceCategoryId[]; take: number }[] = [
  { any: ['campus'], take: 2 },
  { any: ['food'], take: 1 },
  { any: ['minimarket'], take: 1 },
  { any: ['pharmacy'], take: 1 },
  { any: ['clinic', 'hospital'], take: 1 },
  { any: ['atm'], take: 1 },
  { any: ['transit'], take: 1 },
];

const PlaceRow: React.FC<{ p: NearbyItem; tag?: string }> = ({ p, tag }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderTop: '1px solid var(--border-subtle)' }}>
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.9rem' }}>
        <MapPin size={14} color="var(--text-muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
        <span style={{ overflowWrap: 'anywhere' }}>{p.name}</span>
      </div>
      {tag && <div style={{ marginTop: '0.15rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{tag}</div>}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary, var(--text-muted))', fontVariantNumeric: 'tabular-nums' }} title={p.minutesNote}>
        {p.mode === 'walk' ? <Footprints size={14} aria-hidden="true" /> : <Bike size={14} aria-hidden="true" />}
        {p.distanceLabel}, ± {p.minutes} mnt
      </span>
      <a href={directionsUrl(p)} target="_blank" rel="noopener noreferrer" aria-label={`Rute ke ${p.name} di Google Maps`} className="nearby-route" title="Rute di Google Maps">
        <Navigation size={20} strokeWidth={2.5} aria-hidden="true" />
      </a>
    </div>
  </div>
);

/**
 * "Lokasi dan sekitar kos" from the place catalogue (kos.detail.nearby). Opens on "Sorotan" (the nearest few places of the key
 * categories); one icon tab per category (named in a caption line, so tabs never resize) leads to the full list, with "tampilkan lagi" per category, walking or motorbike
 * minutes marked as estimates and a directions link per row.
 */
export const NearbyList: React.FC<{ nearby: NearbyView }> = ({ nearby }) => {
  const [picked, setPicked] = useState<string>('sorotan');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The tab under the pointer or keyboard focus: its name shows in the caption line, so tabs never change size.
  const [hint, setHint] = useState<string | null>(null);
  const groups = nearby.groups.filter((g) => g.items.length + g.more.length > 0);
  const byCategory = new Map(groups.map((g) => [g.category, g]));

  const highlights = HIGHLIGHTS.flatMap(({ any, take }) => {
    const pool = any.flatMap((id) => byCategory.get(id)?.items.map((item) => ({ item, label: byCategory.get(id)!.label })) ?? []);
    return pool.sort((a, b) => a.item.distanceM - b.item.distanceM).slice(0, take);
  });
  // A kos whose only places are outside the highlight categories has nothing to highlight: open on the first chip instead.
  const tabs: { id: string; label: string; Icon: LucideIcon }[] = [
    ...(highlights.length ? [{ id: 'sorotan', label: 'Sorotan', Icon: Star }] : []),
    ...groups.map((g) => ({ id: g.category, label: g.label, Icon: ICONS[g.category as PlaceCategoryId] ?? MapPin })),
  ];
  const active = tabs.some((t) => t.id === picked) ? picked : tabs[0]?.id;
  const group = byCategory.get(active as PlaceCategoryId);

  return (
    <section className="kos-poi detail-card">
      <div className="section-head">
        <h3 className="section-title">Lokasi dan sekitar kos</h3>
      </div>

      {tabs.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>Belum ada data lokasi untuk kos ini.</p>
      ) : (
        <>
        <div className="nearby-chips" role="group" aria-label="Filter kategori lokasi" onMouseLeave={() => setHint(null)}>
          {tabs.map((c) => {
            const isActive = active === c.id;
            return (
              <button key={c.id} type="button" onClick={() => setPicked(c.id)} className={`nearby-chip${isActive ? ' is-selected' : ''}`} aria-pressed={isActive} aria-label={c.label} title={c.label}
                onMouseEnter={() => setHint(c.label)} onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setHint(c.label); }} onBlur={() => setHint(null)}>
                <c.Icon size={18} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <p className="nearby-caption" aria-hidden="true">{hint ?? tabs.find((t) => t.id === active)?.label}</p>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {active === 'sorotan' && (
            <div data-testid="nearby-sorotan">
              {highlights.map(({ item, label }) => <PlaceRow key={item.id} p={item} tag={label} />)}
            </div>
          )}
          {group && (() => {
            const g = group;
            const open = expanded.has(g.category);
            // Five rows to start with, whatever the radius split was; the button lists the rest.
            const all = [...g.items, ...g.more].sort((x, y) => x.distanceM - y.distanceM);
            const items = open ? all : all.slice(0, SHOWN_ROWS);
            const hidden = all.length - SHOWN_ROWS;
            return (
              <div data-testid={`nearby-${g.category}`}>
                {items.map((p) => <PlaceRow key={p.id} p={p} />)}
                {hidden > 0 && (
                  <button type="button" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(g.category)) n.delete(g.category); else n.add(g.category); return n; })}
                    style={{ margin: '0.25rem 0 0', padding: '0.4rem 0', color: 'var(--primary)', fontWeight: 700, fontSize: '0.8125rem' }} aria-expanded={open}>
                    {open ? 'Tampilkan lebih sedikit' : `Tampilkan ${hidden} ${g.label.toLowerCase()} lagi`}
                  </button>
                )}
              </div>
            );
          })()}
        </div>
        </>
      )}
    </section>
  );
};
