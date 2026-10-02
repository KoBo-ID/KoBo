import React from 'react';

/** Same footprint as ListingCard (16:10 photo + body) so grids do not jump when data arrives. */
export const KosCardSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
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
    <div style={{ width: '100%', aspectRatio: '16 / 10', backgroundColor: 'var(--bg-muted)' }} />
    <div style={{ minHeight: '8.5rem' }} />
  </div>
);
