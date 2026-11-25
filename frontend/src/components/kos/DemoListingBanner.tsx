import React from 'react';
import { Badge } from '../ui/Badge';
import { ButtonLink } from '../ui/Button';

interface DemoListingBannerProps {
  /** true = a demo viewer looking at a real kos. */
  mirror: boolean;
  campusId?: string | null;
  campusLabel?: string | null;
}

/** Neutral note on a kos the viewer cannot book because demo and real accounts are kept apart. */
export const DemoListingBanner: React.FC<DemoListingBannerProps> = ({ mirror, campusId, campusLabel }) => {
  const realTo = campusId ? `/search?campus=${encodeURIComponent(campusId)}` : '/search';
  const realLabel = campusId && campusLabel ? `Cari kos sungguhan di sekitar ${campusLabel}` : 'Cari kos sungguhan';
  return (
    <div
      role="note"
      data-testid="demo-listing-banner"
      style={{
        backgroundColor: 'var(--bg-muted)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-card)',
        padding: 'var(--space-s)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '0.5rem',
      }}
    >
      <Badge variant="subtle">{mirror ? 'Kos sungguhan' : 'Kos contoh (demo)'}</Badge>
      <p style={{ margin: 0, fontSize: 'var(--step--1)', color: 'var(--text-main)', lineHeight: 1.5 }}>
        {mirror
          ? 'Akun demo hanya dapat mengajukan sewa, survey, dan daftar tunggu di kos contoh.'
          : 'Kos ini hanya untuk mencoba KoBo dengan akun demo. Pengajuan sewa, survey, dan daftar tunggu tidak tersedia untuk akun Anda.'}
      </p>
      {mirror ? (
        <ButtonLink to="/search" variant="primary" size="md">Lihat kos contoh</ButtonLink>
      ) : (
        <ButtonLink to={realTo} variant="primary" size="md">{realLabel}</ButtonLink>
      )}
    </div>
  );
};
