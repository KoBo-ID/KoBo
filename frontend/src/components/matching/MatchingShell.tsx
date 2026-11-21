import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BadgeCheck, LogIn, Users } from 'lucide-react';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { ErrorState } from '../ui/QueryState';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useSession } from '../../lib/session';
import { MATCH_BASE, isUnverifiedError, useMatchingProfile, useMatchingUnread } from '../../lib/matching';
import { messageForError } from '../../lib/errors';
import { MatchEmptyState } from './EmptyState';
import '../../styles/matching.css';

export type MatchingTab = 'cari' | 'permintaan' | 'pesan' | 'profil' | 'pengaturan';

const TABS: { id: MatchingTab; to: string; label: string; }[] = [
  { id: 'cari', to: MATCH_BASE, label: 'Cari' },
  { id: 'permintaan', to: `${MATCH_BASE}/permintaan`, label: 'Permintaan' },
  { id: 'pesan', to: `${MATCH_BASE}/pesan`, label: 'Pesan' },
  { id: 'profil', to: `${MATCH_BASE}/profil`, label: 'Profil' },
  { id: 'pengaturan', to: `${MATCH_BASE}/pengaturan`, label: 'Pengaturan' },
];

const EXPLAINER =
  'Cari teman sekamar sesama mahasiswa terverifikasi, dicocokkan lewat anggaran, lokasi, tanggal pindah, dan gaya hidup. Yang terlihat hanya nama tampilan dan rentang usia; nomor dan email tidak pernah dibagikan.';

/** Explainer for a visitor who cannot use matching yet: signed out (log in) or not a verified student (verify). */
export const MatchingGate: React.FC<{ kind: 'signed-out' | 'unverified' }> = ({ kind }) => {
  const { pathname, search } = useLocation();
  if (kind === 'signed-out') {
    return (
      <MatchEmptyState
        icon={<Users size={40} />}
        title="Masuk untuk mencari teman sekamar"
        actions={<Link to={`/masuk?next=${encodeURIComponent(pathname + search)}`}><Button variant="primary" icon={<LogIn size={16} />}>Masuk atau daftar</Button></Link>}
      >
        {EXPLAINER} Fitur ini khusus mahasiswa: setelah masuk kamu diminta memverifikasi status mahasiswa.
      </MatchEmptyState>
    );
  }
  return (
    <MatchEmptyState
      icon={<BadgeCheck size={40} />}
      title="Verifikasi status mahasiswa dulu"
      actions={<Link to="/profile"><Button variant="primary" icon={<BadgeCheck size={16} />}>Verifikasi status mahasiswa</Button></Link>}
    >
      {EXPLAINER} Fitur ini hanya untuk mahasiswa terverifikasi supaya tiap profil nyata dan satu kampus dengan kamu.
    </MatchEmptyState>
  );
};

/**
 * Frame for every Teman Sekamar page: title, sub-navigation (Cari, Permintaan, Pesan with unread badge, Profil, Pengaturan)
 * and the access gate. Signed-out and unverified users get the explainer with a login / "Verifikasi status mahasiswa" CTA instead
 * of `children`. The gate is decided by one `matching.profile.get` call (cached, so pages may reuse `useMatchingProfile()`).
 *
 * Props: `active` highlights a tab; `title` is the h1 (and the tab title); `lead` an optional line under it; `children` the page.
 * Pages that are not a tab (detail, kos-together) pass `active` of the nearest tab.
 */
export const MatchingShell: React.FC<{ active: MatchingTab; title: string; lead?: React.ReactNode; children: React.ReactNode }> = ({ active, title, lead, children }) => {
  useDocumentTitle(title);
  const { me, isLoading: sessionLoading } = useSession();
  const profile = useMatchingProfile();
  const unverified = !!me && profile.isError && isUnverifiedError(profile.error);
  const ready = !!me && !profile.isPending && !profile.isError;
  const unread = useMatchingUnread(ready);
  const messages = unread.data?.messages ?? 0;
  const requests = unread.data?.requests ?? 0;
  const counts: Partial<Record<MatchingTab, number>> = { pesan: messages, permintaan: requests };

  let body: React.ReactNode;
  if (sessionLoading || (me && profile.isPending)) {
    body = (
      <div className="mt-stack" aria-busy="true" aria-label="Memuat">
        <Skeleton height="2.5rem" />
        <Skeleton height="9rem" borderRadius="var(--radius-lg)" />
      </div>
    );
  } else if (!me) body = <MatchingGate kind="signed-out" />;
  else if (unverified) body = <MatchingGate kind="unverified" />;
  else if (profile.isError) body = <ErrorState message={messageForError(profile.error)} onRetry={() => void profile.refetch()} minHeight="12rem" />;
  else body = children;

  return (
    <main className="app-container mt-page">
      <header className="mt-head">
        <h1 className="mt-title">{title}</h1>
        {lead && <p className="mt-lead">{lead}</p>}
      </header>
      {ready && (
        <nav className="mt-nav" aria-label="Menu Teman Sekamar">
          {TABS.map((t) => {
            const n = counts[t.id] ?? 0;
            return (
              <Link key={t.id} to={t.to} className="mt-nav__link" aria-current={t.id === active ? 'page' : undefined}>
                {t.label}
                {n > 0 && <span className="mt-count" aria-label={`${n} belum dibaca`}>{n > 99 ? '99+' : n}</span>}
              </Link>
            );
          })}
        </nav>
      )}
      {body}
    </main>
  );
};
