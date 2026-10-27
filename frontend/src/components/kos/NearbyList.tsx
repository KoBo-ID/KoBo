import React, { useState } from 'react';
import { ExternalLink, Footprints, MapPin, Bike } from 'lucide-react';
import type { NearbyItem, NearbyView } from '../../../../backend/src/trpc/router';

const directionsUrl = (item: Pick<NearbyItem, 'lat' | 'lng'>) => `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`;

/**
 * "Lokasi dan sekitar kos" from the place catalogue (kos.detail.nearby): grouped by category with a filter, walking or motorbike
 * minutes marked as estimates, a directions link per row, "tampilkan lebih banyak" per group, and the licence credits the data requires.
 */
export const NearbyList: React.FC<{ nearby: NearbyView }> = ({ nearby }) => {
  const [active, setActive] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = nearby.groups.filter((g) => g.items.length + g.more.length > 0);
  const shown = active === 'all' ? groups : groups.filter((g) => g.category === active);

  return (
    <section className="kos-poi detail-card">
      <div className="section-head">
        <h3 className="section-title">Lokasi dan sekitar kos</h3>
      </div>

      <div className="kos-poi__categories" aria-label="Filter kategori lokasi">
        {[{ id: 'all', label: 'Semua' }, ...groups.map((g) => ({ id: g.category, label: g.label }))].map((c) => {
          const isActive = active === c.id;
          return (
            <button key={c.id} type="button" onClick={() => setActive(c.id)} className={`kos-poi__category${isActive ? ' is-selected' : ''}`} aria-pressed={isActive}
              style={{ padding: '0.4rem 0.8rem', borderRadius: 'var(--radius-sm)', fontSize: '0.785rem', fontWeight: isActive ? 700 : 500, backgroundColor: isActive ? 'var(--primary)' : 'var(--bg-muted)', color: isActive ? 'var(--text-inverse)' : 'var(--text-muted)', border: '1px solid transparent', whiteSpace: 'nowrap' }}>
              {c.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {shown.map((g) => {
          const open = expanded.has(g.category);
          const items = open ? [...g.items, ...g.more] : g.items;
          return (
            <div key={g.category} data-testid={`nearby-${g.category}`}>
              {active === 'all' && <h4 style={{ margin: '1rem 0 0', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>{g.label}</h4>}
              {items.map((p) => (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: '1rem', alignItems: 'center', padding: '0.75rem 0', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.9rem' }}>
                      <MapPin size={14} color="var(--text-muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
                      <span style={{ overflowWrap: 'anywhere' }}>{p.name}</span>
                    </div>
                    <div style={{ marginTop: '0.15rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {p.subcategory ? `${p.subcategory} · ` : ''}{p.sourceLabel}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums' }} title={p.minutesNote}>
                      {p.mode === 'walk' ? <Footprints size={14} aria-hidden="true" /> : <Bike size={14} aria-hidden="true" />}
                      {p.distanceLabel}, ± {p.minutes} mnt
                    </span>
                    <a href={directionsUrl(p)} target="_blank" rel="noopener noreferrer" aria-label={`Rute ke ${p.name} di Google Maps`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--primary)' }}>
                      Rute <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  </div>
                </div>
              ))}
              {g.more.length > 0 && (
                <button type="button" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(g.category)) n.delete(g.category); else n.add(g.category); return n; })}
                  style={{ margin: '0.25rem 0 0', padding: '0.4rem 0', color: 'var(--primary)', fontWeight: 700, fontSize: '0.8125rem' }} aria-expanded={open}>
                  {open ? 'Tampilkan lebih sedikit' : `Tampilkan ${g.more.length} lagi`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ margin: '1rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {nearby.distanceNote}{' '}
        {nearby.attributions.map((a, i) => (
          <React.Fragment key={a.href}>
            {i > 0 && ', '}
            <a href={a.href} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{a.text}</a>
          </React.Fragment>
        ))}
      </p>
    </section>
  );
};
