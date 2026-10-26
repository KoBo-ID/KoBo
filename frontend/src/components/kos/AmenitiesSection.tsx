import React from 'react';
import { Armchair, Bed, Check, CircleParking, DoorClosed, GlassWater, Shirt, Wind, Wifi, ShowerHead, Tv, Shield, WashingMachine, Utensils } from 'lucide-react';

interface AmenitiesSectionProps {
  privateAmenities: string[];
  sharedAmenities: string[];
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

/**
 * Owners type facilities as free text. Related items are kept next to each other by sorting on a keyword topic
 * (stable inside a topic, unmatched items last); no topic labels are shown, so each scope reads as one clean list.
 */
const ROOM_ORDER = [/mandi|shower|toilet|wc|heater/i, /kasur|bed|lemari|meja|kursi|sofa|rak/i, /\bac\b|kipas|\btv\b|jendela|balkon/i];
const BUILDING_ORDER = [/wi-?fi|internet/i, /dapur|kulkas|dispenser|masak|galon|air minum/i, /parkir|cctv|security|kartu|satpam|akses/i, /cuci|jemur|laundry|setrika/i];

const byTopic = (items: string[], order: RegExp[]) => {
  const rank = (item: string) => {
    const index = order.findIndex((test) => test.test(item));
    return index === -1 ? order.length : index;
  };
  return items.map((item, position) => ({ item, position })).sort((a, b) => rank(a.item) - rank(b.item) || a.position - b.position).map((entry) => entry.item);
};


const Item: React.FC<{ icon: React.ReactNode; label: string; note?: string }> = ({ icon, label, note }) => (
  <li className="kos-amenities__item">
    <span className="kos-amenities__icon" aria-hidden="true">{icon}</span>
    <span className="kos-amenities__label">
      {label}
      {note && <small>{note}</small>}
    </span>
  </li>
);

export const AmenitiesSection: React.FC<AmenitiesSectionProps> = ({
  privateAmenities,
  sharedAmenities,
}) => {
  const headingId = React.useId();
  const room = byTopic(privateAmenities, ROOM_ORDER);
  const building = byTopic(sharedAmenities, BUILDING_ORDER);
  return (
    <section className="kos-amenities detail-card" aria-labelledby={`${headingId}-all`}>
      <div className="section-head">
        <h3 id={`${headingId}-all`} className="section-title">Fasilitas</h3>
      </div>

      <div className="kos-amenities__scopes">
        <section className="kos-amenities__scope" aria-labelledby={`${headingId}-room`}>
          <h4 id={`${headingId}-room`}>Kamar</h4>
          <ul className="kos-amenities__list">
            {room.map((item, index) => <Item key={`${item}-${index}`} icon={getIconForAmenity(item)} label={item} />)}
          </ul>
        </section>

        {building.length > 0 && (
          <section className="kos-amenities__scope" aria-labelledby={`${headingId}-building`}>
            <h4 id={`${headingId}-building`}>Kos</h4>
            <ul className="kos-amenities__list">
              {building.map((item, index) => <Item key={`${item}-${index}`} icon={getIconForAmenity(item)} label={item} />)}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
};
