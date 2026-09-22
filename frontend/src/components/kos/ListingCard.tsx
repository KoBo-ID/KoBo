import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Heart, MapPin, Footprints, Shield, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Kos } from '../../types';
import { GenderBadge, Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useAppStore } from '../../store/AppContext';

interface ListingCardProps {
  kos: Kos;
  onOpenSurvey?: (kos: Kos) => void;
}

export const ListingCard: React.FC<ListingCardProps> = ({ kos, onOpenSurvey }) => {
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

  return (
    <div
      onMouseEnter={() => setHoveredKosId(kos.id)}
      onMouseLeave={() => setHoveredKosId(null)}
      onClick={() => navigate(`/kos/${kos.id}`)}
      className="card-hover-lift"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: `1.5px solid ${isHovered ? 'var(--primary)' : 'var(--border-subtle)'}`,
        boxShadow: isHovered ? 'var(--shadow-hover)' : 'var(--shadow-sm)',
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        transition: 'all var(--duration-normal) var(--ease-out-spring)',
      }}
    >
      {/* Photo Carousel Area */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 3',
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

        {/* Carousel Prev/Next Controls */}
        {kos.images.length > 1 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 0.5rem',
              pointerEvents: 'none',
            }}
          >
            <button
              onClick={handlePrevImage}
              className="interactive-tap"
              style={{
                pointerEvents: 'auto',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-main)',
                boxShadow: 'var(--shadow-sm)',
              }}
              aria-label="Foto sebelumnya"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={handleNextImage}
              className="interactive-tap"
              style={{
                pointerEvents: 'auto',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-main)',
                boxShadow: 'var(--shadow-sm)',
              }}
              aria-label="Foto berikutnya"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Photo Dots */}
        <div
          style={{
            position: 'absolute',
            bottom: '0.65rem',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '0.35rem',
            zIndex: 2,
          }}
        >
          {kos.images.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === activeImageIndex ? '14px' : '6px',
                height: '6px',
                borderRadius: 'var(--radius-pill)',
                backgroundColor: i === activeImageIndex ? 'white' : 'rgba(255, 255, 255, 0.5)',
                transition: 'all 0.2s ease',
              }}
            />
          ))}
        </div>

        {/* Top Badges (Gender + Discount) */}
        <div
          style={{
            position: 'absolute',
            top: '0.75rem',
            left: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            zIndex: 2,
          }}
        >
          <GenderBadge gender={kos.gender} size="sm" />
          {kos.studentDiscountLabel && (
            <Badge variant="discount" size="sm">
              🎓 {kos.studentDiscountLabel}
            </Badge>
          )}
        </div>

        {/* Wishlist Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleWishlist(kos.id);
          }}
          className="interactive-tap"
          style={{
            position: 'absolute',
            top: '0.75rem',
            right: '0.75rem',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isSaved ? 'var(--status-overdue)' : 'var(--text-muted)',
            boxShadow: 'var(--shadow-sm)',
            zIndex: 2,
          }}
          aria-label="Simpan ke favorit"
        >
          <Heart size={18} fill={isSaved ? 'var(--status-overdue)' : 'none'} />
        </button>

        {/* Sisa Kamar Pill */}
        {kos.availableRooms <= 3 && (
          <div
            style={{
              position: 'absolute',
              bottom: '0.75rem',
              right: '0.75rem',
              backgroundColor: 'rgba(15, 23, 42, 0.8)',
              color: 'white',
              fontSize: '0.7rem',
              fontWeight: 600,
              padding: '0.2rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
              backdropFilter: 'blur(4px)',
            }}
          >
            Sisa {kos.availableRooms} kamar
          </div>
        )}
      </div>

      {/* Card Content with healthy spacing */}
      <div style={{ padding: '1.125rem', display: 'flex', flexDirection: 'column', gap: '0.85rem', flex: 1 }}>
        {/* Rating & District */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 700, color: 'var(--text-main)' }}>
            <Star size={14} fill="var(--accent)" color="var(--accent)" />
            <span>{kos.rating}</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({kos.reviewCount} ulasan)</span>
          </div>
          <span style={{ color: 'var(--text-muted)' }}>{kos.district}</span>
        </div>

        {/* Separator between metadata and editorial content */}
        <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '0.1rem 0' }} />

        {/* Kos Title */}
        <h3
          className="truncate-1"
          style={{
            fontSize: '1.05rem',
            fontWeight: 700,
            color: 'var(--text-main)',
            lineHeight: 1.3,
          }}
        >
          {kos.name}
        </h3>

        {/* Distance to Campus */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.785rem',
            color: 'var(--primary)',
            fontWeight: 600,
          }}
        >
          <Footprints size={14} />
          <span>
            {kos.campusProximity.distanceMeters}m ke {kos.campusProximity.campusName}
          </span>
        </div>

        {/* Private Amenities Chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', margin: '0.2rem 0' }}>
          {kos.privateAmenities.slice(0, 3).map((amenity, idx) => (
            <span
              key={idx}
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                backgroundColor: 'var(--bg-muted)',
                padding: '0.2rem 0.5rem',
                borderRadius: 'var(--radius-xs)',
              }}
            >
              {amenity}
            </span>
          ))}
          {kos.privateAmenities.length > 3 && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', padding: '0.2rem 0.25rem' }}>
              +{kos.privateAmenities.length - 3} lainnya
            </span>
          )}
        </div>

        {/* Bottom Price & Quick CTA */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 'auto' }}>
          <div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
              Mulai dari
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem' }}>
              <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {formatRupiah(kos.priceMonthlyStart)}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/bln</span>
            </div>
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
              gap: '0.35rem',
              padding: '0.45rem 0.8rem',
              borderRadius: 'var(--radius-btn)',
              fontSize: '0.785rem',
              fontWeight: 600,
              backgroundColor: 'var(--bg-muted)',
              color: 'var(--primary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <Calendar size={13} />
            <span>Survey</span>
          </button>
        </div>
      </div>
    </div>
  );
};
