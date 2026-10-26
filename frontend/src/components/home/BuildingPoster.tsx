import React from 'react';
import posterUrl from '../../assets/hero-poster.webp';

interface BuildingPosterProps {
  className?: string;
  /** True when a live 3D canvas is covering this poster. */
  decorative?: boolean;
}

/**
 * Still frame of the live dorm-section scene, captured from the real three.js
 * render at its first frame (transparent WebP, 1428x952 = the 760px canvas at
 * ~1.9x DPR, ~47KB): teal shell, warm cream rooms, lamps at their resting glow, midday
 * light. Used as:
 *   - the loading state while the three.js chunk streams in,
 *   - the prefers-reduced-motion fallback,
 *   - the no-WebGL fallback,
 *   - and the entire render below 768px, where three.js is never fetched.
 *
 * Because it IS the scene's first frame (the live intro only brightens lamps,
 * it never moves geometry), the cross-fade has no composition jump. Re-capture
 * it whenever the scene's camera, palette, light or layout changes.
 */
export const BuildingPoster: React.FC<BuildingPosterProps> = ({ className, decorative }) => (
  <img
    src={posterUrl}
    className={className}
    width={1428}
    height={952}
    decoding="async"
    alt={decorative ? '' : 'Potongan gedung kos tiga lantai: kamar hangat berperabot dengan penghuni dan lampu menyala, pintu ke koridor'}
    aria-hidden={decorative || undefined}
    style={{ objectFit: 'contain' }}
  />
);
