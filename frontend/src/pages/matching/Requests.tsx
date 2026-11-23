import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Send } from 'lucide-react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ErrorState } from '../../components/ui/QueryState';
import { Notice } from '../../components/ui/Notice';
import { Skeleton } from '../../components/ui/Skeleton';
import { MatchEmptyState } from '../../components/matching/EmptyState';
import { MatchingShell } from '../../components/matching/MatchingShell';
import { RequestRow } from '../../components/matching/RequestRow';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { MATCH_BASE, refusalMessage, useInvalidateMatching, useMatchingProfile } from '../../lib/matching';
import '../../styles/matching.css';
import '../../styles/matching-chat.css';

type Box = 'received' | 'sent';

export const Requests: React.FC = () => (
  <MatchingShell active="permintaan" title="Permintaan Teman Sekamar" lead="Ajakan yang kamu terima dan kirim. Permintaan yang tidak dijawab kedaluwarsa dalam 14 hari.">
    <RequestsBody />
  </MatchingShell>
);

const RequestsBody: React.FC = () => {
  const trpc = useTRPC();
  const invalidate = useInvalidateMatching();
  const profile = useMatchingProfile();
  const [box, setBox] = useState<Box>('received');
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string; capLink?: boolean } | null>(null);
  const [accepted, setAccepted] = useState<string | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);

  const list = useInfiniteQuery(
    trpc.matching.request.list.infiniteQueryOptions({ box }, { getNextPageParam: (last) => last.nextCursor ?? undefined }),
  );
  const onError = (e: unknown) => {
    const text = refusalMessage(e);
    setDeclineId(null);
    setNotice({ tone: 'error', text, capLink: /akhiri satu koneksi|batas koneksi/i.test(text) });
  };
  const accept = useMutation({
    ...trpc.matching.request.accept.mutationOptions(),
    onSuccess: (conn) => { setNotice(null); setAccepted(conn.id); void invalidate(); },
    onError,
  });
  const decline = useMutation({
    ...trpc.matching.request.decline.mutationOptions(),
    onSuccess: () => { setDeclineId(null); setNotice({ tone: 'success', text: 'Permintaan tidak dilanjutkan.' }); void invalidate(); },
    onError,
  });
  const cancel = useMutation({
    ...trpc.matching.request.cancel.mutationOptions(),
    onSuccess: () => { setNotice({ tone: 'success', text: 'Permintaan dibatalkan.' }); void invalidate(); },
    onError,
  });
  const markFound = useMutation({
    ...trpc.matching.profile.markFound.mutationOptions(),
    onSuccess: () => {
      setPauseOpen(false);
      setAccepted(null);
      setNotice({ tone: 'success', text: 'Pencarianmu dijeda dan permintaan yang menunggu dibatalkan. Koneksi yang sudah ada tetap aktif.' });
      void invalidate();
    },
    onError: (e) => { setPauseOpen(false); onError(e); },
  });

  const busy = accept.isPending || decline.isPending || cancel.isPending;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const first = list.data?.pages[0];
  const me = profile.data;
  const askPause = !!accepted && !!me && me.roomShare === 2 && !me.pausedAt;

  return (
    <div className="mt-stack">
      <div className="mc-tabs" role="tablist" aria-label="Kotak permintaan">
        {(['received', 'sent'] as const).map((b) => (
          <button
            key={b}
            type="button"
            role="tab"
            id={`req-tab-${b}`}
            aria-selected={box === b}
            aria-controls="req-panel"
            className="mc-tab"
            onClick={() => { setBox(b); setNotice(null); }}
          >
            {b === 'received' ? 'Diterima' : 'Terkirim'}
          </button>
        ))}
      </div>
      {first && (
        <p className="mt-help" aria-live="polite">
          Sisa {first.sentTodayLeft} permintaan hari ini. Slot permintaan menunggu: {first.pendingSlotsLeft}.
        </p>
      )}
      {notice && (
        <Notice tone={notice.tone}>
          {notice.text}
          {notice.capLink && <> <Link to={`${MATCH_BASE}/pesan`} className="mc-link">Buka Pesan</Link></>}
        </Notice>
      )}
      {accepted && (
        <Notice tone="success">
          Permintaan diterima. <Link to={`${MATCH_BASE}/pesan/${accepted}`} className="mc-link">Mulai ngobrol</Link>
        </Notice>
      )}
      {askPause && (
        <div className="mt-card mt-stack" role="note">
          <p><strong>Sudah dapat teman sekamar?</strong> Kamu bisa menjeda pencarian supaya tidak muncul dan tidak menerima ajakan baru.</p>
          <div className="mt-row">
            <Button size="sm" variant="primary" onClick={() => setPauseOpen(true)}>Jeda pencarian</Button>
            <Button size="sm" variant="ghost" onClick={() => setAccepted(null)}>Nanti saja</Button>
          </div>
        </div>
      )}

      <div id="req-panel" role="tabpanel" aria-labelledby={`req-tab-${box}`} className="mt-stack">
        {list.isPending && (
          <div className="mt-stack" aria-busy="true" aria-label="Memuat permintaan">
            <Skeleton height="7rem" borderRadius="var(--radius-lg)" />
            <Skeleton height="7rem" borderRadius="var(--radius-lg)" />
          </div>
        )}
        {list.isError && <ErrorState message={messageForError(list.error)} onRetry={() => void list.refetch()} minHeight="10rem" />}
        {list.isSuccess && items.length === 0 && (
          <MatchEmptyState
            icon={box === 'received' ? <Inbox size={40} /> : <Send size={40} />}
            title={box === 'received' ? 'Belum ada permintaan masuk' : 'Belum ada permintaan terkirim'}
            actions={<ButtonLink to={MATCH_BASE} variant="primary">Cari teman sekamar</ButtonLink>}
          >
            {box === 'received' ? 'Saat ada yang mengajakmu jadi teman sekamar, permintaannya muncul di sini.' : 'Ajak kandidat yang cocok dari halaman Cari.'}
          </MatchEmptyState>
        )}
        {items.length > 0 && (
          <ul className="mc-reqlist">
            {items.map((r) => (
              <RequestRow
                key={r.id}
                request={r}
                busy={busy}
                onAccept={(id) => { setNotice(null); accept.mutate({ requestId: id }); }}
                onDecline={(id) => setDeclineId(id)}
                onCancel={(id) => { setNotice(null); cancel.mutate({ requestId: id }); }}
              />
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <div><Button variant="outline" size="md" isLoading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Tampilkan lagi</Button></div>
        )}
      </div>

      {declineId && (
        <ConfirmDialog
          title="Tolak permintaan ini?"
          message="Pengirim hanya melihat bahwa permintaannya tidak dilanjutkan, tanpa alasan."
          confirmLabel="Tolak"
          danger
          busy={decline.isPending}
          onConfirm={() => decline.mutate({ requestId: declineId })}
          onCancel={() => setDeclineId(null)}
        />
      )}
      {pauseOpen && (
        <ConfirmDialog
          title="Jeda pencarian?"
          message="Profilmu disembunyikan dan permintaan yang masih menunggu dibatalkan. Koneksi yang sudah ada tetap aktif. Kamu bisa mengaktifkannya lagi di Pengaturan."
          confirmLabel="Jeda pencarian"
          busy={markFound.isPending}
          onConfirm={() => markFound.mutate({})}
          onCancel={() => setPauseOpen(false)}
        />
      )}
    </div>
  );
};
