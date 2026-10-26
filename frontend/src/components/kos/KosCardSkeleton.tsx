import React from 'react';
import { Skeleton } from '../ui/Skeleton';

/** Same footprint as ListingCard (16:10 photo + body) so grids do not jump when data arrives. */
export const KosCardSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
    className="skeleton-shell"
    style={{
      backgroundColor: 'var(--bg-surface)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-subtle)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}
  >
    <div className="skeleton" style={{ width: '100%', aspectRatio: '16 / 10' }} />
    <div style={{ minHeight: '8.5rem', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      <Skeleton width="70%" height="1.1rem" />
      <Skeleton width="48%" height="0.8rem" />
      <Skeleton width="86%" height="0.8rem" />
    </div>
  </div>
);
