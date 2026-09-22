import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Link } from 'react-router-dom';
import { MapPin, Star } from 'lucide-react';
import { Campus, Kos, LocationPin } from '../../types';
import { CAMPUSES } from '../../data/campuses';
import { formatDistance, haversineMeters } from '../../utils/geo';

interface LeafletMapProps {
  kosList: Kos[];
  activeLocation: LocationPin | null;
  hoveredKosId?: string | null;
  onHoverKos?: (id: string | null) => void;
  style?: React.CSSProperties;
  className?: string;
}

const PIN_ZOOM = 15;
const RADIUS_METERS = 500;
const NEARBY_CAMPUS_METERS = 3000;

const gradCapSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/>
    <path d="M22 10v6"/>
    <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>
  </svg>
`;

const locationTargetSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="7"/>
    <line x1="12" y1="2" x2="12" y2="4"/>
    <line x1="12" y1="20" x2="12" y2="22"/>
    <line x1="2" y1="12" x2="4" y2="12"/>
    <line x1="20" y1="12" x2="22" y2="12"/>
    <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>
  </svg>
`;

const MapViewportController: React.FC<{
  pin: LocationPin | null;
  kosList: Kos[];
  campuses: Campus[];
}> = ({ pin, kosList, campuses }) => {
  const map = useMap();
  const [viewportVersion, setViewportVersion] = useState(0);
  const kosListRef = useRef(kosList);
  const campusesRef = useRef(campuses);

  useEffect(() => {
    kosListRef.current = kosList;
  }, [kosList]);

  useEffect(() => {
    campusesRef.current = campuses;
  }, [campuses]);

  const pinLat = pin?.coordinates.lat ?? null;
  const pinLng = pin?.coordinates.lng ?? null;
  const pinKey = pinLat !== null && pinLng !== null ? `${pinLat},${pinLng}` : 'none';

  // Re-run fit only when the container transitions from hidden/zero-size to visible
  useEffect(() => {
    const container = map.getContainer();
    let wasVisible = container.clientWidth > 0 && container.clientHeight > 0;

    const observer = new ResizeObserver(() => {
      const isVisible = container.clientWidth > 0 && container.clientHeight > 0;
      if (isVisible && !wasVisible) {
        wasVisible = true;
        setViewportVersion((version) => version + 1);
      }
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    const container = map.getContainer();
    if (container.clientWidth === 0 || container.clientHeight === 0) return;

    map.invalidateSize();

    if (pinLat !== null && pinLng !== null) {
      map.flyTo([pinLat, pinLng], PIN_ZOOM, {
        duration: 1,
        easeLinearity: 0.3,
      });
      return;
    }

    const points: [number, number][] = [
      ...kosListRef.current.map((k) => [k.coordinates.lat, k.coordinates.lng] as [number, number]),
      ...campusesRef.current.map((c) => [c.coordinates.lat, c.coordinates.lng] as [number, number]),
    ];
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 13 });
    }
  }, [pinKey, pinLat, pinLng, map, viewportVersion]);

  return null;
};

export const LeafletMap: React.FC<LeafletMapProps> = ({
  kosList,
  activeLocation,
  hoveredKosId,
  onHoverKos,
  style,
  className = '',
}) => {
  const nearbyCampuses = useMemo(() => {
    if (!activeLocation) return CAMPUSES;
    return CAMPUSES.filter(
      (campus) => haversineMeters(activeLocation.coordinates, campus.coordinates) <= NEARBY_CAMPUS_METERS
    );
  }, [activeLocation]);

  const center: [number, number] = activeLocation
    ? [activeLocation.coordinates.lat, activeLocation.coordinates.lng]
    : [-6.24, 106.81];

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatPriceChip = (price: number) => {
    const inJuta = price / 1000000;
    return `Rp ${inJuta.toFixed(1).replace('.0', '').replace('.', ',')}jt`;
  };

  return (
    <div
      className={className}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        zIndex: 0,
        isolation: 'isolate',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-sm)',
        ...style,
      }}
    >
      <MapContainer
        center={center}
        zoom={13}
        maxZoom={18}
        scrollWheelZoom={true}
        style={{ width: '100%', height: '100%', background: 'var(--bg-muted)' }}
        attributionControl={false}
      >
        <MapViewportController pin={activeLocation} kosList={kosList} campuses={nearbyCampuses} />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {activeLocation && (
          <>
            <Circle
              center={[activeLocation.coordinates.lat, activeLocation.coordinates.lng]}
              radius={RADIUS_METERS}
              pathOptions={{
                color: 'hsl(190, 95%, 42%)',
                weight: 1.5,
                opacity: 0.7,
                fillColor: 'hsl(190, 95%, 42%)',
                fillOpacity: 0.07,
                dashArray: '5 6',
              }}
            />

            <Marker
              position={[activeLocation.coordinates.lat, activeLocation.coordinates.lng]}
              zIndexOffset={1000}
              icon={L.divIcon({
                className: 'kobo-location-marker-wrapper',
                html: `<div class="kobo-location-pin"><span class="kobo-location-pin__chip">${locationTargetSvg}<span>Titik Lokasi &middot; ${activeLocation.label}</span></span><span class="kobo-location-pin__dot"></span></div>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              })}
            >
              <Popup>
                <div style={{ minWidth: '200px', fontFamily: 'var(--font-sans)' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0F172A' }}>
                    {activeLocation.label}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '0.1rem' }}>
                    {activeLocation.area}, {activeLocation.city}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '0.45rem', lineHeight: 1.5 }}>
                    Titik acuan pencarian. Menampilkan <strong style={{ color: '#0F172A' }}>{kosList.length} kos</strong>
                    {nearbyCampuses.length > 0 && (
                      <>
                        {' '}dan <strong style={{ color: '#0F172A' }}>{nearbyCampuses.length} kampus</strong> di radius {Math.round(
                          RADIUS_METERS / 1000
                        )} km.
                      </>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          </>
        )}

        {nearbyCampuses.map((campus) => (
          <Marker
            key={campus.id}
            position={[campus.coordinates.lat, campus.coordinates.lng]}
            icon={L.divIcon({
              className: 'kobo-poi-marker-wrapper',
              html: `<div class="kobo-poi-pin">${gradCapSvg}<span>${campus.shortName}</span></div>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            })}
          >
            <Popup>
              <div style={{ minWidth: '180px', fontFamily: 'var(--font-sans)' }}>
                <div style={{ fontWeight: 800, fontSize: '0.85rem', color: '#0F172A' }}>{campus.name}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '0.15rem' }}>
                  {campus.city}
                  {activeLocation && (
                    <> &middot; {formatDistance(haversineMeters(activeLocation.coordinates, campus.coordinates))} dari titik lokasi</>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {kosList.map((kos) => {
          const isActive = hoveredKosId === kos.id;

          const priceIcon = L.divIcon({
            className: 'kobo-price-marker-wrapper',
            html: `<div class="kobo-price-pin ${isActive ? 'is-active' : ''}">${formatPriceChip(
              kos.priceMonthlyStart
            )}</div>`,
            iconSize: [76, 28],
            iconAnchor: [38, 14],
          });

          return (
            <Marker
              key={kos.id}
              position={[kos.coordinates.lat, kos.coordinates.lng]}
              icon={priceIcon}
              zIndexOffset={isActive ? 900 : 0}
              eventHandlers={{
                mouseover: () => onHoverKos && onHoverKos(kos.id),
                mouseout: () => onHoverKos && onHoverKos(null),
              }}
            >
              <Popup>
                <div style={{ width: '220px', fontFamily: 'var(--font-sans)', padding: '0.2rem' }}>
                  <img
                    src={kos.images[0]}
                    alt={kos.name}
                    style={{
                      width: '100%',
                      height: '110px',
                      borderRadius: '6px',
                      objectFit: 'cover',
                      marginBottom: '0.45rem',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.7rem', color: '#64748B', textTransform: 'capitalize' }}>
                      Kos {kos.gender}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.75rem', fontWeight: 700, color: '#F59E0B' }}>
                      <Star size={12} fill="#F59E0B" />
                      <span>{kos.rating}</span>
                    </div>
                  </div>
                  <h4 style={{ fontSize: '0.88rem', fontWeight: 700, margin: '0.2rem 0', color: '#0F172A' }}>
                    {kos.name}
                  </h4>
                  <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#1D8758', margin: '0.25rem 0' }}>
                    {formatRupiah(kos.priceMonthlyStart)}
                    <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#64748B' }}> /bln</span>
                  </div>
                  <Link
                    to={`/kos/${kos.id}`}
                    style={{
                      display: 'block',
                      textAlign: 'center',
                      backgroundColor: '#1D8758',
                      color: '#ffffff',
                      padding: '0.4rem',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      textDecoration: 'none',
                      marginTop: '0.5rem',
                    }}
                  >
                    Lihat Kamar
                  </Link>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {!activeLocation && (
        <div
          style={{
            position: 'absolute',
            bottom: '0.75rem',
            left: '0.75rem',
            right: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: 'rgba(255, 255, 255, 0.94)',
            backdropFilter: 'blur(6px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '0.5rem 0.75rem',
            boxShadow: 'var(--shadow-sm)',
            zIndex: 650,
            pointerEvents: 'none',
          }}
        >
          <MapPin size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>
            Cari lokasi atau pakai Lokasi Saya untuk menjadikannya titik acuan peta
          </span>
        </div>
      )}
    </div>
  );
};
