import React, { useState } from 'react';
import { MapPin, Footprints, GraduationCap, Utensils, WashingMachine, Printer, ShoppingCart, HeartPulse } from 'lucide-react';
import { Poi, PoiCategory } from '../../types';

interface PoiRadarProps {
  pois: Poi[];
  campusName?: string;
}

export const PoiRadar: React.FC<PoiRadarProps> = ({ pois }) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const categories: { id: string; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'Semua Lokasi', icon: <MapPin size={14} /> },
    { id: 'campus', label: 'Kampus', icon: <GraduationCap size={14} /> },
    { id: 'food', label: 'Makan & Warung', icon: <Utensils size={14} /> },
    { id: 'laundry', label: 'Laundry Kiloan', icon: <WashingMachine size={14} /> },
    { id: 'print', label: 'Print & Fotokopi', icon: <Printer size={14} /> },
    { id: 'market', label: 'Minimarket & ATM', icon: <ShoppingCart size={14} /> },
    { id: 'health', label: 'Apotek & Klinik', icon: <HeartPulse size={14} /> },
  ];

  const filteredPois = activeCategory === 'all'
    ? pois
    : pois.filter((p) => p.category === activeCategory);

  const getCategoryIcon = (category: PoiCategory) => {
    switch (category) {
      case 'campus':
        return <GraduationCap size={18} color="var(--primary)" />;
      case 'food':
        return <Utensils size={18} color="var(--accent)" />;
      case 'laundry':
        return <WashingMachine size={18} color="var(--text-muted)" />;
      case 'print':
        return <Printer size={18} color="var(--text-muted)" />;
      case 'market':
        return <ShoppingCart size={18} color="var(--text-muted)" />;
      case 'health':
        return <HeartPulse size={18} color="var(--text-muted)" />;
      default:
        return <MapPin size={18} color="var(--text-muted)" />;
    }
  };

  return (
    <section className="kos-poi detail-card">
      <div className="section-head">
        <div>
          <h3 className="section-title">Lokasi dan sekitar kos</h3>
        </div>
      </div>

      {pois.length === 0 ? (
        <p style={{ margin: 0, padding: '0.9rem 1rem', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Belum ada data lokasi untuk kos ini.
        </p>
      ) : (<>
      {/* Category Filter Chips */}
      <div className="kos-poi__categories" aria-label="Filter kategori lokasi">
        {categories.map((cat) => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`kos-poi__category${isActive ? ' is-selected' : ''}`}
              aria-pressed={isActive}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.4rem 0.8rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.785rem',
                fontWeight: isActive ? 700 : 500,
                backgroundColor: isActive ? 'var(--primary)' : 'var(--bg-muted)',
                color: isActive ? 'white' : 'var(--text-muted)',
                border: '1px solid transparent',
                whiteSpace: 'nowrap',
                transition: 'background-color var(--duration-fast) var(--ease-out-spring), border-color var(--duration-fast) var(--ease-out-spring), color var(--duration-fast) var(--ease-out-spring)',
              }}
            >
              {cat.icon}
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* POI Listing Cards */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {filteredPois.map((poi) => (
          <div
            key={poi.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '1rem 0',
              borderTop: '1px solid var(--border-subtle)',
              transition: 'background-color var(--duration-fast) var(--ease-out-spring), border-color var(--duration-fast) var(--ease-out-spring), color var(--duration-fast) var(--ease-out-spring), box-shadow var(--duration-fast) var(--ease-out-spring), transform var(--duration-fast) var(--ease-out-spring), opacity var(--duration-fast) var(--ease-out-spring)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
              <span style={{ display: 'flex', flexShrink: 0, marginTop: '0.1rem' }}>
                {getCategoryIcon(poi.category)}
              </span>
              <div>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  {poi.name}
                </h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.4 }}>
                  {poi.description}
                </p>
              </div>
            </div>

            {/* Distance */}
            <span
              style={{
                fontSize: '0.85rem',
                fontWeight: 800,
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                flexShrink: 0,
              }}
            >
              <Footprints size={14} />
              Jarak {poi.distanceMeters} m
            </span>
          </div>
        ))}

        {filteredPois.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
            Belum ada data lokasi untuk kategori ini.
          </div>
        )}
      </div>
      </>)}
    </section>
  );
};
