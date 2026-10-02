import React from 'react';
import posterUrl from '../../assets/hero-poster.webp';

interface BuildingPosterProps {
  className?: string;
  /** True when a live 3D canvas is covering this poster. */
  decorative?: boolean;
}

/**
 * Still frame of the live dorm-section scene, captured from the real three.js
 * render (transparent WebP, 1428x952 = the canvas at 2x DPR, ~36KB). Used as:
 *   - the loading state while the three.js chunk streams in,
 *   - the prefers-reduced-motion fallback,
 *   - the no-WebGL fallback,
 *   - and the entire render below 768px, where three.js is never fetched.
 *
 * Because it IS a frame of the scene, the cross-fade to the live canvas has no
 * composition jump. Re-capture it whenever the scene's camera, palette or
 * layout changes.
 */
export const BuildingPoster: React.FC<BuildingPosterProps> = ({ className, decorative }) => (
  <img
    src={posterUrl}
    className={className}
    width={1428}
    height={952}
    decoding="async"
    alt={decorative ? '' : 'Potongan gedung kos: kamar berperabot dengan pintu ke koridor'}
    aria-hidden={decorative || undefined}
    style={{ objectFit: 'contain' }}
  />
);
