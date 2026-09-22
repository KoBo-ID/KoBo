import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Kos } from '../../types';
import { CAMPUSES } from '../../data/campuses';
import { Link } from 'react-router-dom';
import { Star, Navigation } from 'lucide-react';

interface LeafletMapProps {
  kosList: Kos[];
  selectedCampusId?: string;
  hoveredKosId?: string | null;
  onHoverKos?: (id: string | null) => void;
  style?: React.CSSProperties;
  className?: string;
}

// Map center controller for smooth flyTo animations
const MapController: React.FC<{ center: [number, number]; zoom: number }> = ({ center, zoom }) => {
  const map = useMap();

  useEffect(() => {
    map.flyTo(center, zoom, {
      duration: 1.2,
      easeLinearity: 0.25,
    });
  }, [center, zoom, map]);

  return null;
};

export const LeafletMap: React.FC<LeafletMapProps> = ({
  kosList,
  selectedCampusId,
  hoveredKosId,
  onHoverKos,
  style,
  className = '',
}) => {
  // Determine center campus
  const activeCampus = useMemo(() => {
    return CAMPUSES.find((c) => c.id === selectedCampusId) || CAMPUSES[0];
  }, [selectedCampusId]);

  const mapCenter: [number, number] = [activeCampus.coordinates.lat, activeCampus.coordinates.lng];

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
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-sm)',
        ...style,
      }}
    >
      <MapContainer
        center={mapCenter}
        zoom={14}
        scrollWheelZoom={true}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
      >
        <MapController center={mapCenter} zoom={14} />

        {/* Clean OpenStreetMap Tiles */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Campus Center Pin */}
        <Marker
          position={[activeCampus.coordinates.lat, activeCampus.coordinates.lng]}
          icon={L.divIcon({
            className: 'kobo-campus-marker-wrapper',
            html: `<div class="kobo-campus-pin">🎓 ${activeCampus.shortName}</div>`,
            iconSize: [130, 30],
            iconAnchor: [65, 15],
          })}
        >
          <Popup>
            <div style={{ padding: '0.25rem', fontFamily: 'var(--font-sans)' }}>
              <div style={{ fontWeight: 800, fontSize: '0.85rem' }}>{activeCampus.name}</div>
              <div style={{ fontSize: '0.75rem', color: '#64748B' }}>Titik radius pencarian kos mahasiswa</div>
            </div>
          </Popup>
        </Marker>

        {/* Kos Listings Price Markers */}
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
    </div>
  );
};
