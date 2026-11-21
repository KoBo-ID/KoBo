import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, GraduationCap, MapPin } from 'lucide-react';
import type { MatchCandidate } from '@kobo/shared/types';
import { Badge } from '../ui/Badge';
import { AGE_BAND_LABEL, MATCH_BASE, formatKm, formatMoveIn, GENDER_LABEL } from '../../lib/matching';
import { ScoreBadge, ScoreBreakdown } from './ScoreBreakdown';
import '../../styles/matching.css';

const RELATION_LABEL: Record<MatchCandidate['relation'], string | null> = {
  NONE: null,
  REQUEST_SENT: 'Permintaan terkirim',
  REQUEST_RECEIVED: 'Mengajakmu',
  CONNECTED: 'Terhubung',
};

/**
 * A candidate in the Discover grid. The whole card links to the detail page (`/teman-sekamar/p/:profileId`).
 * Shows display name, age band, campus, score with band and a two-line breakdown, distance (0.5 km steps) and move-in date.
 */
export const CandidateCard: React.FC<{ candidate: MatchCandidate }> = ({ candidate: c }) => {
  const relation = RELATION_LABEL[c.relation];
  return (
    <Link to={`${MATCH_BASE}/p/${c.profileId}`} className="mt-card mt-card--link">
      <div className="mt-card__top">
        <div style={{ minWidth: 0 }}>
          <div className="mt-card__name">{c.displayName}</div>
          <div className="mt-card__sub">{GENDER_LABEL[c.gender]}, {AGE_BAND_LABEL(c.ageBand)}</div>
        </div>
        <ScoreBadge match={c.match} />
      </div>
      <div className="mt-facts">
        {c.campusLabel && <span><GraduationCap size={14} aria-hidden="true" />{c.campusLabel}</span>}
        <span><MapPin size={14} aria-hidden="true" />{formatKm(c.distanceKm)} dari lokasimu</span>
        <span><CalendarDays size={14} aria-hidden="true" />Pindah {formatMoveIn(c.moveInDate)}</span>
      </div>
      <ScoreBreakdown match={c.match} compact />
      {relation && <div><Badge variant="booking" size="sm">{relation}</Badge></div>}
    </Link>
  );
};

/** Placeholder with the same footprint while the list loads. */
export const CandidateCardSkeleton: React.FC = () => (
  <div className="mt-card" aria-hidden="true" style={{ minHeight: '11rem' }}>
    <div className="skeleton" style={{ height: '1.4rem', width: '55%', marginBottom: '0.6rem' }} />
    <div className="skeleton" style={{ height: '0.9rem', width: '80%', marginBottom: '0.5rem' }} />
    <div className="skeleton" style={{ height: '0.9rem', width: '65%' }} />
  </div>
);
