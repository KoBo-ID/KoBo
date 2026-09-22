import React, { useState } from 'react';
import { Grid, X, ChevronLeft, ChevronRight } from 'lucide-react';

interface PhotoHeroMosaicProps {
  images: string[];
  kosName: string;
}

export const PhotoHeroMosaic: React.FC<PhotoHeroMosaicProps> = ({ images, kosName }) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  const displayImages = images.slice(0, 5);

  const openLightbox = (index: number) => {
    setActivePhotoIdx(index);
    setLightboxOpen(true);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActivePhotoIdx((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActivePhotoIdx((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  return (
    <div style={{ position: 'relative', width: '100%', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      {/* 5-Photo Mosaic Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gridTemplateRows: 'repeat(2, 200px)',
          gap: '0.5rem',
          backgroundColor: 'var(--bg-muted)',
        }}
      >
        {/* Large Hero Image (Spans 2 cols, 2 rows) */}
        {displayImages[0] && (
          <div
            onClick={() => openLightbox(0)}
            style={{
              gridColumn: 'span 2',
              gridRow: 'span 2',
              position: 'relative',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            <img
              src={displayImages[0]}
              alt={`${kosName} 1`}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transition: 'transform 0.3s var(--ease-out-spring)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            />
          </div>
        )}

        {/* 4 Secondary Images */}
        {displayImages.slice(1, 5).map((img, idx) => {
          const actualIndex = idx + 1;
          return (
            <div
              key={actualIndex}
              onClick={() => openLightbox(actualIndex)}
              style={{
                position: 'relative',
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              <img
                src={img}
                alt={`${kosName} ${actualIndex + 1}`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transition: 'transform 0.3s var(--ease-out-spring)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              />
            </div>
          );
        })}
      </div>

      {/* "Lihat Semua Foto" Floating Button */}
      <button
        onClick={() => openLightbox(0)}
        className="interactive-tap"
        style={{
          position: 'absolute',
          bottom: '1rem',
          right: '1rem',
          backgroundColor: 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(6px)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.45rem 0.85rem',
          fontSize: '0.8125rem',
          fontWeight: 700,
          color: 'var(--text-main)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <Grid size={15} />
        <span>Lihat Semua ({images.length} Foto)</span>
      </button>

      {/* Fullscreen Lightbox Modal */}
      {lightboxOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 'var(--z-modal)',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '1.5rem',
          }}
          onClick={() => setLightboxOpen(false)}
          className="animate-fade-in"
        >
          {/* Top Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: 'white',
              zIndex: 2,
            }}
          >
            <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>
              {kosName} · Foto {activePhotoIdx + 1} dari {images.length}
            </span>
            <button
              onClick={() => setLightboxOpen(false)}
              className="interactive-tap"
              style={{
                color: 'white',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                padding: '0.5rem',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Center Display with Prev/Next */}
          <div
            style={{
              position: 'relative',
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1rem 0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handlePrev}
              className="interactive-tap"
              style={{
                position: 'absolute',
                left: '1rem',
                color: 'white',
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                padding: '0.75rem',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ChevronLeft size={24} />
            </button>

            <img
              src={images[activePhotoIdx]}
              alt={`${kosName} Fullview`}
              style={{
                maxHeight: '75vh',
                maxWidth: '85vw',
                objectFit: 'contain',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-xl)',
              }}
            />

            <button
              onClick={handleNext}
              className="interactive-tap"
              style={{
                position: 'absolute',
                right: '1rem',
                color: 'white',
                backgroundColor: 'rgba(255, 255, 255, 0.2)',
                padding: '0.75rem',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ChevronRight size={24} />
            </button>
          </div>

          {/* Bottom Thumbnails Strip */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              justifyContent: 'center',
              overflowX: 'auto',
              padding: '0.5rem 0',
              zIndex: 2,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {images.map((img, i) => (
              <img
                key={i}
                src={img}
                alt={`Thumb ${i}`}
                onClick={() => setActivePhotoIdx(i)}
                style={{
                  width: '60px',
                  height: '42px',
                  objectFit: 'cover',
                  borderRadius: 'var(--radius-xs)',
                  cursor: 'pointer',
                  border: i === activePhotoIdx ? '2px solid var(--accent)' : '2px solid transparent',
                  opacity: i === activePhotoIdx ? 1 : 0.6,
                  transition: 'all 0.2s ease',
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
