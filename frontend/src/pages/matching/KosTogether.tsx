import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/QueryState';
import { Notice } from '../../components/ui/Notice';
import { Skeleton } from '../../components/ui/Skeleton';
import { KosCandidateCard } from '../../components/matching/KosCandidateCard';
import { MatchEmptyState } from '../../components/matching/EmptyState';
import { MatchingShell } from '../../components/matching/MatchingShell';
import { ShortlistPanel } from '../../components/matching/ShortlistPanel';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { MATCH_BASE, refusalMessage, useConnections, useInvalidateMatching } from '../../lib/matching';
import '../../styles/matching.css';
import '../../styles/matching-chat.css';

export const KosTogether: React.FC = () => (
  <MatchingShell active="pesan" title="Cari Kos Bersama" lead="Kos yang cukup untuk anggaran kalian berdua dan dekat dari titik tengah lokasi pilihan kalian.">
    <KosTogetherBody />
  </MatchingShell>
);

const KosTogetherBody: React.FC = () => {
  const { connectionId = '' } = useParams<{ connectionId: string }>();
  const trpc = useTRPC();
  const invalidate = useInvalidateMatching();
  const connections = useConnections();
  const conn = connections.data?.find((c) => c.id === connectionId);
  const live = !!conn && !conn.endedAt;
  const candidates = useQuery({ ...trpc.matching.shortlist.kosCandidates.queryOptions({ connectionId }), enabled: live, retry: false });
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const add = useMutation({
    ...trpc.matching.shortlist.add.mutationOptions(),
    onMutate: (v) => { setAddingId(v.kosId); setError(null); },
    onSuccess: () => { void invalidate(); },
    onError: (e) => setError(refusalMessage(e)),
    onSettled: () => setAddingId(null),
  });

  if (connections.isPending) return <div className="mt-stack" aria-busy="true" aria-label="Memuat"><Skeleton height="6rem" borderRadius="var(--radius-lg)" /><Skeleton height="6rem" borderRadius="var(--radius-lg)" /></div>;
  if (connections.isError) return <ErrorState message={messageForError(connections.error)} onRetry={() => void connections.refetch()} minHeight="12rem" />;
  if (!conn) {
    return (
      <MatchEmptyState title="Koneksi tidak ditemukan" actions={<Link to={`${MATCH_BASE}/pesan`}><Button variant="outline">Ke Pesan</Button></Link>}>
        Koneksi ini tidak ada atau bukan milikmu.
      </MatchEmptyState>
    );
  }

  return (
    <div className="mt-stack">
      <p className="mt-help">
        Bersama <strong>{conn.partner.displayName}</strong> · <Link to={`${MATCH_BASE}/pesan/${conn.id}`} className="mc-link">Kembali ke obrolan</Link>
      </p>

      <section className="mt-stack" aria-labelledby="kt-list">
        <h2 id="kt-list" className="mt-section-title">Daftar kos bersama</h2>
        <ShortlistPanel connectionId={conn.id} live={live} />
      </section>

      <section className="mt-stack" aria-labelledby="kt-sug">
        <h2 id="kt-sug" className="mt-section-title">Saran kos untuk kalian</h2>
        {error && <Notice tone="error">{error}</Notice>}
        {!live && <p className="mt-help">Saran tidak tersedia karena koneksi sudah berakhir.</p>}
        {live && candidates.isPending && <div className="mt-stack" aria-busy="true" aria-label="Memuat saran kos"><Skeleton height="6rem" borderRadius="var(--radius-lg)" /><Skeleton height="6rem" borderRadius="var(--radius-lg)" /></div>}
        {live && candidates.isError && <ErrorState message={messageForError(candidates.error)} onRetry={() => void candidates.refetch()} minHeight="8rem" />}
        {live && candidates.isSuccess && candidates.data.length === 0 && (
          <MatchEmptyState icon={<Building2 size={36} />} title="Belum ada kos yang cocok">
            Belum ada kamar kosong yang masuk anggaran gabungan kalian di sekitar titik tengah. Coba perluas anggaran atau radius di profil.
          </MatchEmptyState>
        )}
        {live && candidates.isSuccess && candidates.data.length > 0 && (
          <ul className="mc-reqlist">
            {candidates.data.map((c) => (
              <KosCandidateCard key={c.kosId} candidate={c} adding={addingId === c.kosId} disabled={add.isPending} onAdd={(kosId) => add.mutate({ connectionId: conn.id, kosId })} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
