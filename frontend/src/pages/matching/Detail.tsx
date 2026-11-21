import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Flag } from 'lucide-react';
import { LIFESTYLE_KEYS, LIFESTYLE_LABEL, LIFESTYLE_VALUE_LABEL } from '@kobo/shared/domain';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/QueryState';
import { BlockButton } from '../../components/matching/BlockButton';
import { MatchEmptyState } from '../../components/matching/EmptyState';
import { MatchingShell } from '../../components/matching/MatchingShell';
import { ReportDialog } from '../../components/matching/ReportDialog';
import { RequestButton } from '../../components/matching/RequestButton';
import { ScoreBadge, ScoreBreakdown } from '../../components/matching/ScoreBreakdown';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { isNotFound } from '../../lib/queryErrors';
import {
  AGE_BAND_LABEL, GENDER_LABEL, KOS_TYPE_LABEL, MATCH_BASE, activeAgo, formatBudget, formatKm, formatMoveIn,
} from '../../lib/matching';
import '../../styles/matching.css';

export const Detail: React.FC = () => (
  <MatchingShell active="cari" title="Profil teman sekamar">
    <DetailBody />
  </MatchingShell>
);

const DetailBody: React.FC = () => {
  const { id = '' } = useParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [reporting, setReporting] = useState(false);
  const q = useQuery({ ...trpc.matching.detail.queryOptions({ profileId: id }), retry: false });

  const back = <Link to={MATCH_BASE} className="mt-help" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><ArrowLeft size={14} aria-hidden="true" />Kembali ke pencarian</Link>;

  if (q.isPending) {
    return (
      <div className="mt-stack" aria-busy="true" aria-label="Memuat profil">
        <Skeleton height="6rem" borderRadius="var(--radius-lg)" />
        <Skeleton height="14rem" borderRadius="var(--radius-lg)" />
      </div>
    );
  }
  if (q.isError) {
    // One friendly copy for every hidden case (blocked, inactive, deleted): it never says why.
    if (isNotFound(q.error)) {
      return (
        <div className="mt-stack">
          {back}
          <MatchEmptyState title="Profil tidak tersedia" actions={<Link to={MATCH_BASE}><Button variant="primary">Kembali ke pencarian</Button></Link>}>
            Profil ini tidak bisa dilihat saat ini. Coba lihat kandidat lainnya.
          </MatchEmptyState>
        </div>
      );
    }
    return <ErrorState message={messageForError(q.error)} onRetry={() => void q.refetch()} minHeight="14rem" />;
  }

  const c = q.data;
  return (
    <div className="mt-stack">
      {back}
      <section className="mt-card mt-stack" aria-labelledby="det-name">
        <div className="mt-card__top">
          <div style={{ minWidth: 0 }}>
            <h2 id="det-name" className="mt-card__name" style={{ fontSize: 'var(--step-2)' }}>{c.displayName}</h2>
            <div className="mt-card__sub">{GENDER_LABEL[c.gender]}, {AGE_BAND_LABEL(c.ageBand)}{c.campusLabel ? ` | ${c.campusLabel}` : ''}</div>
            <div className="mt-card__sub">{activeAgo(c.lastActiveAt)}</div>
          </div>
          <ScoreBadge match={c.match} />
        </div>
        {c.intro ? <p style={{ lineHeight: 1.6, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{c.intro}</p> : <p className="mt-muted">Belum menulis perkenalan.</p>}
        <RequestButton candidate={c} />
      </section>

      <section className="mt-card" aria-labelledby="det-score">
        <h2 id="det-score" className="mt-section-title">Kenapa cocok</h2>
        <ScoreBreakdown match={c.match} />
      </section>

      <section className="mt-card" aria-labelledby="det-sewa">
        <h2 id="det-sewa" className="mt-section-title">Rencana sewa</h2>
        <dl className="mt-defs">
          <div><dt>Anggaran per bulan</dt><dd>{formatBudget(c.budgetMin, c.budgetMax)}</dd></div>
          <div><dt>Area</dt><dd>{c.anchorLabel} (radius {c.radiusKm} km)</dd></div>
          <div><dt>Jarak dari lokasimu</dt><dd>{formatKm(c.distanceKm)}</dd></div>
          <div><dt>Tanggal pindah</dt><dd>{formatMoveIn(c.moveInDate)}</dd></div>
          <div><dt>Durasi</dt><dd>{c.durationMonths} bulan</dd></div>
          <div><dt>Tipe kos</dt><dd>{KOS_TYPE_LABEL[c.kosType]}</dd></div>
          <div><dt>Satu kamar untuk</dt><dd>{c.roomShare} orang</dd></div>
        </dl>
      </section>

      <section className="mt-card" aria-labelledby="det-gaya">
        <h2 id="det-gaya" className="mt-section-title">Gaya hidup</h2>
        <dl className="mt-defs">
          {LIFESTYLE_KEYS.map((k) => {
            const labels = LIFESTYLE_VALUE_LABEL[k] as Record<string, string>;
            return <div key={k}><dt>{LIFESTYLE_LABEL[k]}</dt><dd>{labels[c[k]] ?? c[k]}</dd></div>;
          })}
        </dl>
      </section>

      <div className="mt-row">
        <Button variant="outline" size="sm" icon={<Flag size={14} />} onClick={() => setReporting(true)}>Laporkan</Button>
        <BlockButton profileId={c.profileId} displayName={c.displayName} onBlocked={() => navigate(MATCH_BASE)} />
      </div>
      {reporting && <ReportDialog profileId={c.profileId} displayName={c.displayName} connectionId={c.connectionId ?? undefined} onClose={() => setReporting(false)} />}
    </div>
  );
};
