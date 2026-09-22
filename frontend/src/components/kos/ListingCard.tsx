import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Heart, MapPin, Footprints, ChevronLeft, ChevronRight, Calendar, GraduationCap } from 'lucide-react';
import { Kos } from '../../types';
import { GenderBadge, Badge } from '../ui/Badge';
import { useAppStore } from '../../store/AppContext';
import { formatDistance } from '../../utils/geo';

interface ListingCardProps {
  kos: Kos;
  onOpenSurvey?: (kos: Kos) => void;
  distance?: number;
}

export const ListingCard: React.FC<ListingCardProps> = ({ kos, onOpenSurvey, distance }) => {
  const navigate = useNavigate();
  const { currentUser, toggleWishlist, hoveredKosId, setHoveredKosId } = useAppStore();
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const isSaved = currentUser.savedKosIds.includes(kos.id);
  const isHovered = hoveredKosId === kos.id;

  const handlePrevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveImageIndex((prev) => (prev > 0 ? prev - 1 : kos.images.length - 1));
  };

  const handleNextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveImageIndex((prev) => (prev < kos.images.length - 1 ? prev + 1 : 0));
  };

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const distanceLabel =
    distance !== undefined
      ? `${formatDistance(distance)} dari titik lokasi`
      : `${kos.campusProximity.distanceMeters} m ke ${kos.campusProximity.campusName}`;

  return (
    <div
      onMouseEnter={() => setHoveredKosId(kos.id)}
      onMouseLeave={() => setHoveredKosId(null)}
      onClick={() => navigate(`/kos/${kos.id}`)}
      className="card-hover-lift"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: `1px solid ${isHovered ? 'var(--primary)' : 'var(--border-subtle)'}`,
        boxShadow: isHovered ? 'var(--shadow-hover)' : 'var(--shadow-sm)',
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        height: '100%',
        transition: 'all var(--duration-normal) var(--ease-out-spring)',
      }}
    >
      {/* Photo Area */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 10',
          backgroundColor: 'var(--bg-muted)',
          overflow: 'hidden',
        }}
      >
        <img
          src={kos.images[activeImageIndex]}
          alt={kos.name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'transform 0.4s var(--ease-out-spring)',
          }}
        />

        {/* Carousel Controls */}
        {kos.images.length > 1 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 0.4rem',
              pointerEvents: 'none',
            }}
          >
            <button
              onClick={handlePrevImage}
              className="interactive-tap"
              style={{
                pointerEvents: 'auto',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.88)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-main)',
                boxShadow: 'var(--shadow-sm)',
              }}
              aria-label="Foto sebelumnya"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={handleNextImage}
              className="interactive-tap"
              style={{
                pointerEvents: 'auto',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.88)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-main)',
                boxShadow: 'var(--shadow-sm)',
              }}
              aria-label="Foto berikutnya"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {/* Photo Dots */}
        <div
          style={{
            position: 'absolute',
            bottom: '0.5rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '0.3rem',
            zIndex: 2,
          }}
        >
          {kos.images.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === activeImageIndex ? '12px' : '5px',
                height: '5px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: i === activeImageIndex ? 'white' : 'rgba(255, 255, 255, 0.55)',
                transition: 'all 0.2s ease',
              }}
            />
          ))}
        </div>

        {/* Top Badges */}
        <div
          style={{
            position: 'absolute',
            top: '0.55rem',
            left: '0.55rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            zIndex: 2,
          }}
        >
          <GenderBadge gender={kos.gender} size="sm" />
          {kos.studentDiscountAmount > 0 && (
            <Badge variant="discount" size="sm" icon={<GraduationCap size={11} />}>
              {kos.studentDiscountLabel}
            </Badge>
          )}
        </div>

        {/* Wishlist */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleWishlist(kos.id);
          }}
          className="interactive-tap"
          style={{
            position: 'absolute',
            top: '0.55rem',
            right: '0.55rem',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isSaved ? 'var(--status-overdue)' : 'var(--text-muted)',
            boxShadow: 'var(--shadow-sm)',
            zIndex: 2,
          }}
          aria-label="Simpan ke favorit"
        >
          <Heart size={15} fill={isSaved ? 'var(--status-overdue)' : 'none'} />
        </button>

        {/* Remaining Rooms */}
        {kos.availableRooms <= 3 && (
          <div
            style={{
              position: 'absolute',
              bottom: '0.5rem',
              right: '0.5rem',
              backgroundColor: 'rgba(15, 23, 42, 0.8)',
              color: 'white',
              fontSize: '0.68rem',
              fontWeight: 600,
              padding: '0.18rem 0.45rem',
              borderRadius: 'var(--radius-xs)',
              backdropFilter: 'blur(4px)',
            }}
          >
            Sisa {kos.availableRooms} kamar
          </div>
        )}
      </div>

      {/* Compact Content */}
      <div style={{ padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.45rem', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.78rem', fontWeight: 700 }}>
            <Star size={13} fill="var(--accent)" color="var(--accent)" />
            <span>{kos.rating}</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({kos.reviewCount})</span>
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              minWidth: 0,
            }}
          >
            <MapPin size={11} />
            <span className="truncate-1">{kos.district}</span>
          </span>
        </div>

        <h3
          className="truncate-1"
          style={{
            fontSize: '0.92rem',
            fontWeight: 700,
            color: 'var(--text-main)',
            lineHeight: 1.3,
          }}
        >
          {kos.name}
        </h3>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            fontSize: '0.75rem',
            color: 'var(--primary)',
            fontWeight: 600,
          }}
        >
          <Footprints size={13} />
          <span className="truncate-1">{distanceLabel}</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            marginTop: 'auto',
            paddingTop: '0.3rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem', minWidth: 0 }}>
            <span style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
              {formatRupiah(kos.priceMonthlyStart)}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/bln</span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onOpenSurvey) {
                onOpenSurvey(kos);
              } else {
                navigate(`/kos/${kos.id}`);
              }
            }}
            className="interactive-tap"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.35rem 0.6rem',
              borderRadius: 'var(--radius-btn)',
              fontSize: '0.72rem',
              fontWeight: 700,
              backgroundColor: 'var(--primary-light)',
              color: 'var(--primary)',
              border: '1px solid hsla(176, 55%, 80%, 0.9)',
              flexShrink: 0,
            }}
          >
            <Calendar size={12} />
            <span>Survey</span>
          </button>
        </div>
      </div>
    </div>
  );
};
