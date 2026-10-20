import React from 'react';
import { Armchair, Bed, Check, CircleParking, DoorClosed, GlassWater, Shirt, Wind, Wifi, ShowerHead, Tv, Shield, WashingMachine, Utensils, Zap } from 'lucide-react';

interface AmenitiesSectionProps {
  privateAmenities: string[];
  sharedAmenities: string[];
  electricityType: 'included' | 'token';
}

const getIconForAmenity = (name: string) => {
  const lower = name.toLowerCase();
  if (/\bac\b/.test(lower)) return <Wind size={18} color="var(--primary)" />;
  if (lower.includes('mandi') || lower.includes('water heater')) return <ShowerHead size={18} color="var(--primary)" />;
  if (lower.includes('kasur') || lower.includes('bed')) return <Bed size={18} color="var(--primary)" />;
  if (lower.includes('wi-fi') || lower.includes('wifi')) return <Wifi size={18} color="var(--primary)" />;
  if (lower.includes('meja') || lower.includes('kursi')) return <Armchair size={18} color="var(--primary)" />;
  if (lower.includes('lemari')) return <DoorClosed size={18} color="var(--primary)" />;
  if (lower.includes('parkir')) return <CircleParking size={18} color="var(--primary)" />;
  if (lower.includes('jemur')) return <Shirt size={18} color="var(--primary)" />;
  if (lower.includes('dispenser')) return <GlassWater size={18} color="var(--primary)" />;
  if (lower.includes('dapur') || lower.includes('masak')) return <Utensils size={18} color="var(--primary)" />;
  if (lower.includes('cuci')) return <WashingMachine size={18} color="var(--primary)" />;
  if (lower.includes('security') || lower.includes('cctv') || lower.includes('kartu')) return <Shield size={18} color="var(--primary)" />;
  if (/\btv\b/.test(lower)) return <Tv size={18} color="var(--primary)" />;
  return <Check size={18} color="var(--primary)" />;
};

export const AmenitiesSection: React.FC<AmenitiesSectionProps> = ({
  privateAmenities,
  sharedAmenities,
  electricityType,
}) => {
  const headingId = React.useId();
  return (
    <div className="kos-amenities">
      <div className="kos-amenities__groups">
      {/* Fasilitas Kamar (Private) */}
      <section className="kos-amenities__group" aria-labelledby={`${headingId}-private`}>
        <header className="kos-amenities__heading">
          <h3 id={`${headingId}-private`} className="section-title">Fasilitas kamar</h3>
        </header>
        <ul className="kos-amenities__list">
          {privateAmenities.map((item, idx) => (
            <li key={`${item}-${idx}`} className="kos-amenities__item">
              <span className="kos-amenities__icon" aria-hidden="true">{getIconForAmenity(item)}</span>
              <span className="kos-amenities__label">{item}</span>
            </li>
          ))}

          <li className="kos-amenities__item">
            <span className="kos-amenities__icon" aria-hidden="true">
              <Zap size={18} color="var(--primary)" />
            </span>
            <span className="kos-amenities__label">
              Listrik {electricityType === 'included' ? 'termasuk sewa' : 'token mandiri'}
            </span>
          </li>
        </ul>
      </section>

      {/* Fasilitas Bersama (Shared) */}
      {sharedAmenities.length > 0 && <section className="kos-amenities__group" aria-labelledby={`${headingId}-shared`}>
        <header className="kos-amenities__heading">
          <h3 id={`${headingId}-shared`} className="section-title">Fasilitas kos</h3>
        </header>
        <ul className="kos-amenities__list">
          {sharedAmenities.map((item, idx) => (
            <li key={`${item}-${idx}`} className="kos-amenities__item">
              <span className="kos-amenities__icon" aria-hidden="true">{getIconForAmenity(item)}</span>
              <span className="kos-amenities__label">{item}</span>
            </li>
          ))}
        </ul>
      </section>}
      </div>
    </div>
  );
};
