import React from 'react';
import { FACILITY_GROUPS, statusLabel } from '@kobo/shared/facilities';
import type { FacilityItem } from '@kobo/shared/facilities';
import { formatRupiah } from '../../lib/format';
import { Armchair, Bed, Check, CircleParking, DoorClosed, GlassWater, Shirt, Wind, Wifi, ShowerHead, Tv, Shield, WashingMachine, Utensils } from 'lucide-react';

interface AmenitiesSectionProps {
  facilities: FacilityItem[];
  building?: { floors: number | null; yearBuilt: number | null; areaM2: number | null; roomCount: number };
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


const Item: React.FC<{ item: FacilityItem }> = ({ item }) => (
  <li className="kos-amenities__item">
    <span className="kos-amenities__icon" aria-hidden="true">{getIconForAmenity(item.label)}</span>
    <span className="kos-amenities__label">
      {item.label}
      {item.note && <small>{item.note}</small>}
    </span>
    {/* Included is the default and says nothing; only the exception (paid, with its fee) gets a pill. */}
    {item.status === 'PAID' && <span className="kos-amenities__status is-paid">{statusLabel(item, formatRupiah)}</span>}
  </li>
);

export const AmenitiesSection: React.FC<AmenitiesSectionProps> = ({ facilities, building }) => {
  const headingId = React.useId();
  const room = byTopic(facilities.filter((f) => f.scope === 'KAMAR').map((f) => f.label), ROOM_ORDER).map((label) => facilities.find((f) => f.scope === 'KAMAR' && f.label === label)!);
  const groups = FACILITY_GROUPS.filter((g) => g.scope === 'GEDUNG')
    .map((g) => ({ ...g, items: facilities.filter((f) => f.scope === 'GEDUNG' && f.group === g.id) }))
    .filter((g) => g.items.length > 0);
  const facts = [
    building?.floors ? { label: 'Lantai', value: String(building.floors) } : null,
    building?.roomCount ? { label: 'Kamar', value: String(building.roomCount) } : null,
    building?.areaM2 ? { label: 'Luas bangunan', value: `${building.areaM2} m²` } : null,
  ].filter((f): f is { label: string; value: string } => f !== null);

  return (
    <section className="kos-amenities detail-card" aria-labelledby={`${headingId}-all`}>
      <div className="section-head">
        <h3 id={`${headingId}-all`} className="section-title">Fasilitas</h3>
      </div>

      {facts.length > 0 && (
        <dl className="kos-amenities__facts" aria-label="Informasi bangunan">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="kos-amenities__scopes">
        <section className="kos-amenities__scope" aria-labelledby={`${headingId}-room`}>
          <h4 id={`${headingId}-room`}>Kamar</h4>
          {room.length === 0 ? (
            <p className="kos-amenities__empty">Pemilik belum mengisi fasilitas kamar.</p>
          ) : (
            <ul className="kos-amenities__list">
              {room.map((item) => <Item key={item.label} item={item} />)}
            </ul>
          )}
        </section>

        <section className="kos-amenities__scope" aria-labelledby={`${headingId}-building`}>
          <h4 id={`${headingId}-building`}>Gedung</h4>
          {groups.length === 0 ? (
            <p className="kos-amenities__empty">Pemilik belum mengisi fasilitas gedung.</p>
          ) : (
            groups.map((g) => (
              <div key={g.id} className="kos-amenities__group">
                <h5>{g.label}</h5>
                <ul className="kos-amenities__list">
                  {g.items.map((item) => <Item key={item.label} item={item} />)}
                </ul>
              </div>
            ))
          )}
        </section>
      </div>
    </section>
  );
};
