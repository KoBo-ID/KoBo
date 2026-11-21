import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/QueryState';
import { Skeleton } from '../../components/ui/Skeleton';
import { ChatThread } from '../../components/matching/ChatThread';
import { ConversationList } from '../../components/matching/ConversationList';
import { MatchEmptyState } from '../../components/matching/EmptyState';
import { MatchingShell } from '../../components/matching/MatchingShell';
import { messageForError } from '../../lib/errors';
import { MATCH_BASE, useConnections } from '../../lib/matching';
import '../../styles/matching.css';
import '../../styles/matching-chat.css';

export const Messages: React.FC = () => (
  <MatchingShell active="pesan" title="Pesan Teman Sekamar">
    <MessagesBody />
  </MatchingShell>
);

const MessagesBody: React.FC = () => {
  const { connectionId } = useParams<{ connectionId?: string }>();
  const list = useConnections();

  if (list.isPending) {
    return (
      <div className="mt-stack" aria-busy="true" aria-label="Memuat percakapan">
        <Skeleton height="4rem" borderRadius="var(--radius-lg)" />
        <Skeleton height="4rem" borderRadius="var(--radius-lg)" />
        <Skeleton height="4rem" borderRadius="var(--radius-lg)" />
      </div>
    );
  }
  if (list.isError) return <ErrorState message={messageForError(list.error)} onRetry={() => void list.refetch()} minHeight="12rem" />;

  const connections = list.data;
  if (connections.length === 0) {
    return (
      <MatchEmptyState
        icon={<MessageCircle size={40} />}
        title="Belum ada koneksi"
        actions={<Link to={MATCH_BASE}><Button variant="primary">Cari teman sekamar</Button></Link>}
      >
        Obrolan muncul di sini setelah ada permintaan yang diterima.
      </MatchEmptyState>
    );
  }

  const current = connectionId ? connections.find((c) => c.id === connectionId) : undefined;
  return (
    <div className="mc-layout" data-view={connectionId ? 'thread' : 'list'}>
      <div className="mc-layout__list">
        <ConversationList connections={connections} {...(connectionId ? { activeId: connectionId } : {})} />
      </div>
      <div className="mc-layout__thread">
        {connectionId && (
          <Link to={`${MATCH_BASE}/pesan`} className="mc-back mc-link"><ArrowLeft size={16} aria-hidden="true" /> Semua percakapan</Link>
        )}
        {current ? (
          <ChatThread key={current.id} connection={current} />
        ) : connectionId ? (
          <MatchEmptyState title="Percakapan tidak ditemukan" actions={<Link to={`${MATCH_BASE}/pesan`}><Button variant="outline">Lihat semua percakapan</Button></Link>}>
            Percakapan ini tidak ada atau bukan milikmu.
          </MatchEmptyState>
        ) : (
          <MatchEmptyState icon={<MessageCircle size={36} />} title="Pilih percakapan">
            Pilih salah satu teman sekamar di daftar untuk membaca dan membalas pesan.
          </MatchEmptyState>
        )}
      </div>
    </div>
  );
};
