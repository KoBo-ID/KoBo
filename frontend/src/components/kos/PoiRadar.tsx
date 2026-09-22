import React, { useState } from 'react';
import { MapPin, Footprints, GraduationCap, Utensils, WashingMachine, Printer, ShoppingCart, HeartPulse } from 'lucide-react';
import { Poi, PoiCategory } from '../../types';

interface PoiRadarProps {
  pois: Poi[];
  campusName: string;
}

export const PoiRadar: React.FC<PoiRadarProps> = ({ pois, campusName }) => {
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
        return <WashingMachine size={18} color="#0284C7" />;
      case 'print':
        return <Printer size={18} color="#7C3AED" />;
      case 'market':
        return <ShoppingCart size={18} color="#059669" />;
      case 'health':
        return <HeartPulse size={18} color="#E11D48" />;
      default:
        return <MapPin size={18} color="var(--text-muted)" />;
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        padding: '1.5rem',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MapPin size={22} color="var(--accent)" />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
              Radar Sekitar Kos
            </h3>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Akses fasilitas esensial mahasiswa sekitar {campusName} dengan estimasi jarak jalan kaki riil.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            color: 'var(--primary)',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          <Footprints size={14} />
          <span>Bebas Macet & Hemat Ongkos</span>
        </div>
      </div>

      {/* Category Filter Chips */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          overflowX: 'auto',
          paddingBottom: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        {categories.map((cat) => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className="interactive-tap"
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
                transition: 'all var(--duration-fast) var(--ease-out-spring)',
              }}
            >
              {cat.icon}
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* POI Listing Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filteredPois.map((poi) => (
          <div
            key={poi.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '1rem',
              padding: '0.875rem 1rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-page)',
              transition: 'all var(--duration-fast) var(--ease-out-spring)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '0.1rem',
                }}
              >
                {getCategoryIcon(poi.category)}
              </div>
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
              {poi.distanceMeters} meter
            </span>
          </div>
        ))}

        {filteredPois.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
            Belum ada data lokasi untuk kategori ini.
          </div>
        )}
      </div>
    </div>
  );
};
