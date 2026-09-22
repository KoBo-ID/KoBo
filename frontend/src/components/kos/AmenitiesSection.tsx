import React from 'react';
import { Bed, Wind, Wifi, ShowerHead, Tv, Coffee, Shield, WashingMachine, Utensils, Zap } from 'lucide-react';

interface AmenitiesSectionProps {
  privateAmenities: string[];
  sharedAmenities: string[];
  electricityType: 'included' | 'token';
}

export const AmenitiesSection: React.FC<AmenitiesSectionProps> = ({
  privateAmenities,
  sharedAmenities,
  electricityType,
}) => {
  const getIconForAmenity = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('ac')) return <Wind size={18} color="var(--primary)" />;
    if (lower.includes('mandi') || lower.includes('water heater')) return <ShowerHead size={18} color="var(--primary)" />;
    if (lower.includes('kasur') || lower.includes('bed')) return <Bed size={18} color="var(--primary)" />;
    if (lower.includes('wi-fi') || lower.includes('wifi')) return <Wifi size={18} color="var(--primary)" />;
    if (lower.includes('tv')) return <Tv size={18} color="var(--primary)" />;
    if (lower.includes('dapur') || lower.includes('masak')) return <Utensils size={18} color="var(--primary)" />;
    if (lower.includes('cuci')) return <WashingMachine size={18} color="var(--primary)" />;
    if (lower.includes('security') || lower.includes('cctv') || lower.includes('kartu')) return <Shield size={18} color="var(--primary)" />;
    return <Coffee size={18} color="var(--primary)" />;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Fasilitas Kamar (Private) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Bed size={20} color="var(--primary)" />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Fasilitas Kamar Pribadi</h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '0.85rem',
          }}
        >
          {privateAmenities.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--bg-muted)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'var(--text-main)',
              }}
            >
              <span style={{ display: 'flex', flexShrink: 0 }}>{getIconForAmenity(item)}</span>
              <span>{item}</span>
            </div>
          ))}

          {/* Electricity Info Tile */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              backgroundColor: 'var(--bg-muted)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--text-main)',
            }}
          >
            <span style={{ display: 'flex', flexShrink: 0 }}>
              <Zap size={18} color="var(--primary)" />
            </span>
            <span>
              Listrik: {electricityType === 'included' ? 'Sudah Termasuk Sewa' : 'Token Mandiri (Hemat Sendiri)'}
            </span>
          </div>
        </div>
      </div>

      {/* Fasilitas Bersama (Shared) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Utensils size={20} color="var(--primary)" />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Fasilitas Bersama Gedung</h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '0.85rem',
          }}
        >
          {sharedAmenities.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--bg-muted)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: 'var(--text-main)',
              }}
            >
              <span style={{ display: 'flex', flexShrink: 0 }}>{getIconForAmenity(item)}</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
