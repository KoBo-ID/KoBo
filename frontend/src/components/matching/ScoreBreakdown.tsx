import React from 'react';
import { MATCH_BAND_LABEL } from '@kobo/shared/domain';
import type { MatchScoreView } from '@kobo/shared/types';
import { PART_LABEL } from '../../lib/matching';
import '../../styles/matching.css';

/** Score badge: "78%" with the band name beneath it ("Cocok banget"); "Perkiraan" is added when the answers are thin. */
export const ScoreBadge: React.FC<{ match: MatchScoreView }> = ({ match }) => (
  <span className="mt-score" data-band={match.band}>
    <span className="mt-score__num">{match.score}%</span>
    <span className="mt-score__band">{MATCH_BAND_LABEL[match.band]}{match.approximate ? ' (perkiraan)' : ''}</span>
  </span>
);

/**
 * Per-criterion explanation of a match score.
 * - `match`: the server's MatchScoreView (parts sum to score).
 * - `compact`: the card variant, the two criteria that earned the most points as "label  points/max" lines (no bars).
 * Full variant: a bar plus "points dari max" text plus the Indonesian reason for every criterion, so colour is never the only signal.
 */
export const ScoreBreakdown: React.FC<{ match: MatchScoreView; compact?: boolean }> = ({ match, compact = false }) => {
  if (compact) {
    const top = [...match.parts].sort((a, b) => b.points / b.max - a.points / a.max).slice(0, 2);
    return (
      <ul className="mt-mini" aria-label="Rincian singkat skor">
        {top.map((p) => (
          <li key={p.key}>
            <span>{PART_LABEL[p.key] ?? p.key}</span>
            <span className="mt-mini__pts">{p.points}/{p.max}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div>
      <ul className="mt-parts" aria-label="Rincian skor kecocokan">
        {match.parts.map((p) => (
          <li key={p.key}>
            <div className="mt-part__head">
              <span>{PART_LABEL[p.key] ?? p.key}</span>
              <span className="mt-part__pts">{p.points} dari {p.max} poin</span>
            </div>
            <span className="mt-bar" aria-hidden="true"><span style={{ width: `${p.max > 0 ? Math.min(100, (p.points / p.max) * 100) : 0}%` }} /></span>
            <span className="mt-part__why">{p.reason}</span>
          </li>
        ))}
      </ul>
      {match.approximate && (
        <p className="mt-help" style={{ marginTop: 'var(--space-xs)' }}>
          Skor ini perkiraan: gaya hidup belum banyak diisi, jadi bagian itu dinilai netral. Makin lengkap profil kalian, makin akurat.
        </p>
      )}
    </div>
  );
};
