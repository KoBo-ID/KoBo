import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Star, MapPin, Footprints, ChevronLeft, ChevronRight, Calendar, GraduationCap } from 'lucide-react';
import { Kos } from '../../types';
import { GenderBadge, Badge } from '../ui/Badge';
import { useQueryClient } from '@tanstack/react-query';
import { setHoveredKosId, useIsKosHovered } from '../../store/hoverStore';
import { useTRPC } from '../../lib/trpc';
import { formatDistance } from '../../utils/geo';
import { SafeImage, widthSrcSet } from '../ui/SafeImage';
import { formatRupiah } from '../../lib/format';

interface ListingCardProps {
  kos: Kos;
  onOpenSurvey?: (kos: Kos) => void;
  distance?: number;
  /** Position in the list: the first row loads eagerly, the rest lazily; the very first photo is the LCP candidate. */
  index?: number;
}

const EAGER_CARDS = 3;

const ListingCardBase: React.FC<ListingCardProps> = ({ kos, onOpenSurvey, distance, index = EAGER_CARDS }) => {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const isHovered = useIsKosHovered(kos.id);
  // Start the detail request when the user shows intent, so the page often opens with its data already in the cache.
  const prefetchDetail = () => void queryClient.prefetchQuery(trpc.kos.detail.queryOptions({ id: kos.id }));

  const handlePrevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveImageIndex((prev) => (prev > 0 ? prev - 1 : kos.images.length - 1));
  };

  const handleNextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveImageIndex((prev) => (prev < kos.images.length - 1 ? prev + 1 : 0));
  };
  const distanceLabel =
    distance !== undefined
      ? `${formatDistance(distance)} dari titik lokasi`
      : kos.campusProximity.campusName
        ? `${kos.campusProximity.distanceMeters} m ke ${kos.campusProximity.campusName}`
        : 'Jarak ke kampus belum tersedia';

  return (
    <div
      onMouseEnter={() => setHoveredKosId(kos.id)}
      onMouseLeave={() => setHoveredKosId(null)}
      className="card-hover-lift"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: `1px solid ${isHovered ? 'var(--primary)' : 'var(--border-subtle)'}`,
        boxShadow: isHovered ? 'var(--shadow-hover)' : 'var(--shadow-sm)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        height: '100%',
        transition: 'background-color var(--duration-normal) var(--ease-out-spring), border-color var(--duration-normal) var(--ease-out-spring), color var(--duration-normal) var(--ease-out-spring), box-shadow var(--duration-normal) var(--ease-out-spring), transform var(--duration-normal) var(--ease-out-spring), opacity var(--duration-normal) var(--ease-out-spring)',
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
        <SafeImage
          src={kos.images[activeImageIndex]}
          alt={kos.name}
          width={800}
          height={500}
          sizes="(min-width: 1024px) 340px, 100vw"
          {...widthSrcSet(kos.images[activeImageIndex], [480, 800])}
          loading={index < EAGER_CARDS ? 'eager' : 'lazy'}
          fetchPriority={index === 0 ? 'high' : undefined}
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
              padding: '0 0.625rem',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <button
              onClick={handlePrevImage}
              className="interactive-tap kobo-carousel-btn"
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
              className="interactive-tap kobo-carousel-btn"
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
            pointerEvents: 'none',
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
                transition: 'background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease',
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
            right: '0.55rem',
            display: 'flex',
            flexWrap: 'wrap', // a narrow card stacks whole badges instead of breaking the discount text
            alignItems: 'center',
            gap: '0.35rem',
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          <GenderBadge gender={kos.gender} size="sm" />
          {kos.isDemoListing === true && <Badge variant="subtle" size="sm">Kos contoh</Badge>}
          {kos.studentDiscountAmount > 0 && (
            <Badge variant="discount" size="sm" icon={<GraduationCap size={11} />}>
              {kos.studentDiscountLabel}
            </Badge>
          )}
        </div>

        {/* Remaining Rooms */}
        {kos.totalRooms > 0 && kos.availableRooms <= 3 && (
          <div
            style={{
              position: 'absolute',
              bottom: '0.5rem',
              right: '0.5rem',
              backgroundColor: 'rgba(15, 23, 42, 0.8)',
              color: 'white',
              fontSize: 'var(--step--2)',
              fontWeight: 600,
              padding: '0.18rem 0.45rem',
              borderRadius: 'var(--radius-xs)',
            }}
          >
            {kos.availableRooms === 0 ? 'Penuh' : `Sisa ${kos.availableRooms} kamar`}
          </div>
        )}
      </div>

      {/* Compact Content */}
      <div style={{ padding: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.45rem', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: 'var(--step--2)', fontWeight: 700 }}>
            {kos.reviewCount > 0 ? (
              <>
                <Star size={13} fill="var(--accent)" color="var(--accent)" />
                <span>{kos.rating}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({kos.reviewCount})</span>
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Belum ada ulasan</span>
            )}
          </div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              fontSize: 'var(--step--2)',
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
            fontSize: 'var(--step--1)',
            fontWeight: 700,
            color: 'var(--text-main)',
            lineHeight: 1.3,
          }}
        >
          <Link to={`/kos/${kos.id}`} className="listing-card__link" onPointerEnter={prefetchDetail} onFocus={prefetchDetail}>{kos.name}</Link>
        </h3>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            fontSize: 'var(--step--2)',
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
            flexWrap: 'wrap', // a narrow card puts Survey under the price instead of colliding with "/bln"
            gap: '0.5rem',
            marginTop: 'auto',
            paddingTop: '0.3rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem', minWidth: 0 }}>
            <span style={{ fontSize: 'var(--step-0)', fontWeight: 800, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
              {formatRupiah(kos.priceMonthlyStart)}
            </span>
            <span style={{ fontSize: 'var(--step--2)', color: 'var(--text-muted)' }}>/bln</span>
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
            className="interactive-tap listing-card__survey"
            style={{
              position: 'relative',
              zIndex: 2,
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.35rem 0.6rem',
              borderRadius: 'var(--radius-btn)',
              fontSize: 'var(--step--2)',
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

export const ListingCard = React.memo(ListingCardBase);
