import React, { useEffect, useRef, useState } from 'react';
import { Grid, X, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { SafeImage, widthSrcSet } from '../ui/SafeImage';

interface PhotoHeroMosaicProps {
  images: string[];
  kosName: string;
}

export const PhotoHeroMosaic: React.FC<PhotoHeroMosaicProps> = ({ images, kosName }) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  const displayImages = images.slice(0, 5);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // The lightbox behaves like a dialog: focus goes in, Escape closes, arrows page, focus returns to what opened it.
  useEffect(() => {
    if (!lightboxOpen) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      else if (e.key === 'ArrowLeft') setActivePhotoIdx((p) => (p > 0 ? p - 1 : images.length - 1));
      else if (e.key === 'ArrowRight') setActivePhotoIdx((p) => (p < images.length - 1 ? p + 1 : 0));
      else if (e.key === 'Tab') { e.preventDefault(); closeRef.current?.focus(); } // only the close button and arrows act; keep focus in the lightbox
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openerRef.current?.focus();
    };
  }, [lightboxOpen, images.length]);

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

  // No photos: a quiet placeholder, no gallery button, nothing that could open an empty lightbox.
  if (images.length === 0) {
    return (
      <div
        role="img"
        aria-label={`${kosName}: belum ada foto`}
        style={{
          width: '100%',
          height: '200px',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'var(--bg-muted)',
          border: '1px dashed var(--border-strong)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          color: 'var(--text-muted)',
          fontSize: 'var(--step--1)',
        }}
      >
        <ImageOff size={28} aria-hidden="true" />
        <span>Foto kos ini belum tersedia</span>
      </div>
    );
  }

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
          <button
            type="button"
            aria-label={`Buka foto 1 dari ${images.length}`}
            onClick={() => openLightbox(0)}
            style={{
              padding: 0,
              border: 0,
              background: 'none',
              gridColumn: 'span 2',
              gridRow: 'span 2',
              position: 'relative',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            <SafeImage
              src={displayImages[0]}
              alt={`${kosName} 1`}
              width={800}
              height={500}
              sizes="(min-width: 1024px) 50vw, 100vw"
              {...widthSrcSet(displayImages[0], [640, 800])}
              fetchPriority="high"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transition: 'transform 0.3s var(--ease-out-spring)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            />
          </button>
        )}

        {/* 4 Secondary Images */}
        {displayImages.slice(1, 5).map((img, idx) => {
          const actualIndex = idx + 1;
          return (
            <button
              key={actualIndex}
              type="button"
              aria-label={`Buka foto ${actualIndex + 1} dari ${images.length}`}
              onClick={() => openLightbox(actualIndex)}
              style={{
                padding: 0,
                border: 0,
                background: 'none',
                position: 'relative',
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              <SafeImage
                src={img}
                alt={`${kosName} ${actualIndex + 1}`}
                width={400}
                height={300}
                sizes="(min-width: 1024px) 25vw, 50vw"
                {...widthSrcSet(img, [400, 800])}
                loading="lazy"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transition: 'transform 0.3s var(--ease-out-spring)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              />
            </button>
          );
        })}
      </div>

      {/* "Lihat Semua Foto" Floating Button */}
      <button
        type="button"
        onClick={() => openLightbox(0)}
        className="interactive-tap"
        style={{
          position: 'absolute',
          bottom: '1rem',
          right: '1rem',
          backgroundColor: 'rgba(255, 255, 255, 0.94)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.45rem 0.85rem',
          fontSize: 'var(--step--1)',
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
          role="dialog"
          aria-modal="true"
          aria-label={`Galeri foto ${kosName}`}
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
            <span style={{ fontSize: 'var(--step-0)', fontWeight: 600 }}>
              {kosName} · Foto {activePhotoIdx + 1} dari {images.length}
            </span>
            <button
              ref={closeRef}
              type="button"
              aria-label="Tutup galeri foto"
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
              <X size={20} aria-hidden="true" />
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
              type="button"
              aria-label="Foto sebelumnya"
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
              <ChevronLeft size={24} aria-hidden="true" />
            </button>

            <SafeImage
              src={images[activePhotoIdx]}
              alt={`${kosName} Fullview`}
              placeholderStyle={{ width: 'min(85vw, 960px)', height: '60vh', backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
              iconSize={40}
              style={{
                maxHeight: '75vh',
                maxWidth: '85vw',
                objectFit: 'contain',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-xl)',
              }}
            />

            <button
              type="button"
              aria-label="Foto berikutnya"
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
              <ChevronRight size={24} aria-hidden="true" />
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
              <SafeImage
                key={i}
                src={img}
                alt={`Foto ${i + 1}`}
                width={60}
                height={42}
                sizes="60px"
                {...widthSrcSet(img, [120, 240])}
                loading="lazy"
                iconSize={16}
                onClick={() => setActivePhotoIdx(i)}
                style={{
                  width: '60px',
                  height: '42px',
                  objectFit: 'cover',
                  borderRadius: 'var(--radius-xs)',
                  cursor: 'pointer',
                  border: i === activePhotoIdx ? '2px solid var(--accent)' : '2px solid transparent',
                  opacity: i === activePhotoIdx ? 1 : 0.6,
                  transition: 'background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease',
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
