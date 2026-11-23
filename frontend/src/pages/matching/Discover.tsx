import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Link2, Search, UserPlus, UsersRound } from 'lucide-react';
import { isCalendarDay } from '@kobo/shared/domain';
import { PRICE_MAX } from '@kobo/shared/search';
import type { DiscoverInput } from '@kobo/shared/schemas';
import type { DiscoverResult } from '@kobo/shared/types';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/QueryState';
import { Notice } from '../../components/ui/Notice';
import { CandidateCard, CandidateCardSkeleton } from '../../components/matching/CandidateCard';
import { MatchEmptyState } from '../../components/matching/EmptyState';
import { MatchingShell } from '../../components/matching/MatchingShell';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { formatRupiah } from '../../lib/format';
import { MATCH_BASE, todayWib, useInvalidateMatching, useMatchingProfile } from '../../lib/matching';
import '../../styles/matching.css';

const RADII = [1, 2, 3, 5, 8, 10, 15];
const BUDGETS = Array.from({ length: 7 }, (_, i) => (i + 1) * 500_000); // up to PRICE_MAX (3.500.000)

/** The filters live in the URL: ?jarak=5&min=1000000&maks=2000000&pindah=2027-01-15&urut=jarak. */
function readFilters(sp: URLSearchParams) {
  const raw = (k: string) => {
    const v = sp.get(k)?.trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const jarak = raw('jarak');
  const clampBudget = (k: string) => {
    const n = raw(k);
    return n !== null && n >= 0 ? Math.min(PRICE_MAX, Math.max(0, Math.round(n))) : undefined;
  };
  const day = sp.get('pindah');
  return {
    maxDistanceKm: jarak !== null && jarak > 0 ? Math.min(15, Math.max(1, Math.round(jarak))) : undefined,
    budgetMin: clampBudget('min'),
    budgetMax: clampBudget('maks'),
    moveInBefore: day && isCalendarDay(day) ? day : undefined,
    sort: sp.get('urut') === 'jarak' ? ('jarak' as const) : ('skor' as const),
  };
}

const Filters: React.FC<{ params: URLSearchParams; set: (key: string, value: string | null) => void; clear: () => void; active: boolean }> = ({ params, set, clear, active }) => (
  <form className="mt-filters" aria-label="Filter pencarian" onSubmit={(e) => e.preventDefault()}>
    <div className="mt-field">
      <label htmlFor="f-jarak">Radius maksimal</label>
      <select id="f-jarak" className="mt-control" value={params.get('jarak') ?? ''} onChange={(e) => set('jarak', e.target.value || null)}>
        <option value="">Semua jarak</option>
        {RADII.map((r) => <option key={r} value={r}>{r} km</option>)}
      </select>
    </div>
    <div className="mt-field">
      <label htmlFor="f-min">Anggaran dari</label>
      <select id="f-min" className="mt-control" value={params.get('min') ?? ''} onChange={(e) => set('min', e.target.value || null)}>
        <option value="">Bebas</option>
        {BUDGETS.map((b) => <option key={b} value={b}>{formatRupiah(b)}</option>)}
      </select>
    </div>
    <div className="mt-field">
      <label htmlFor="f-maks">Anggaran sampai</label>
      <select id="f-maks" className="mt-control" value={params.get('maks') ?? ''} onChange={(e) => set('maks', e.target.value || null)}>
        <option value="">Bebas</option>
        {BUDGETS.map((b) => <option key={b} value={b}>{formatRupiah(b)}</option>)}
      </select>
    </div>
    <div className="mt-field">
      <label htmlFor="f-pindah">Pindah sebelum</label>
      <input id="f-pindah" type="date" className="mt-control" min={todayWib()} value={params.get('pindah') ?? ''} onChange={(e) => set('pindah', e.target.value || null)} />
    </div>
    <div className="mt-field">
      <span className="mt-label" id="f-urut">Urutkan</span>
      <div className="kobo-segmented" role="group" aria-labelledby="f-urut">
        <button type="button" aria-pressed={params.get('urut') !== 'jarak'} onClick={() => set('urut', null)}>Skor</button>
        <button type="button" aria-pressed={params.get('urut') === 'jarak'} onClick={() => set('urut', 'jarak')}>Jarak</button>
      </div>
    </div>
    {active && <div className="mt-field"><Button type="button" variant="ghost" size="sm" onClick={clear}>Hapus filter</Button></div>}
  </form>
);

/** The "invite a friend" hint for the cold start: native share where available, else copy. The link carries no profile id. */
const InviteHint: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${MATCH_BASE}`;
  const share = async () => {
    const text = 'Cari teman sekamar sesama mahasiswa di KoBo.';
    try {
      if (navigator.share) { await navigator.share({ title: 'KoBo Teman Sekamar', text, url }); return; }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch { /* cancelled or clipboard blocked: nothing to do */ }
  };
  return (
    <>
      <Button variant="outline" size="md" icon={<Link2 size={16} />} onClick={() => void share()}>Ajak temanmu</Button>
      {copied && <span role="status" className="mt-help">Tautan disalin.</span>}
    </>
  );
};

const EmptyByReason: React.FC<{ data: DiscoverResult; hasFilters: boolean; onWiden: (km: number) => void; onClear: () => void }> = ({ data, hasFilters, onWiden, onClear }) => {
  const trpc = useTRPC();
  const profile = useMatchingProfile();
  const invalidate = useInvalidateMatching();
  const activate = useMutation({ ...trpc.matching.profile.setActive.mutationOptions(), onSuccess: () => void invalidate() });
  const paused = !!profile.data?.pausedAt;

  switch (data.emptyReason) {
    case 'NO_PROFILE':
      return (
        <MatchEmptyState icon={<UserPlus size={40} />} title="Buat profil dulu" actions={<ButtonLink to={`${MATCH_BASE}/profil`} variant="primary">Buat profil</ButtonLink>}>
          Isi data intinya (sekitar 2 menit) supaya kami bisa mencocokkanmu dengan mahasiswa lain. Profilmu langsung aktif setelah langkah pertama.
        </MatchEmptyState>
      );
    case 'INACTIVE':
      if (profile.data?.hiddenByReportsAt) {
        return <MatchEmptyState icon={<UsersRound size={40} />} title="Profilmu sedang disembunyikan">Profilmu sedang ditinjau setelah ada laporan. Hubungi kami lewat halaman Kontak jika kamu merasa ini keliru.</MatchEmptyState>;
      }
      return (
        <MatchEmptyState
          icon={<UsersRound size={40} />}
          title={paused ? 'Pencarianmu sedang dijeda' : 'Profilmu sedang nonaktif'}
          actions={<Button variant="primary" isLoading={activate.isPending} onClick={() => activate.mutate({ active: true })}>Aktifkan</Button>}
        >
          Aktifkan profil untuk melihat dan mengirim permintaan ke teman sekamar yang cocok.
          {activate.isError && <span style={{ display: 'block', marginTop: '0.5rem' }}><Notice tone="error">{messageForError(activate.error)}</Notice></span>}
        </MatchEmptyState>
      );
    case 'COLD_START':
      return (
        <MatchEmptyState
          icon={<UsersRound size={40} />}
          title="Belum ada teman yang cocok"
          actions={<><InviteHint /><ButtonLink to="/search" variant="ghost" size="md" icon={<Search size={16} />}>Cari kos sendiri dulu</ButtonLink></>}
        >
          Belum ada mahasiswa lain yang cocok di sekitarmu. Coba lagi beberapa hari lagi, atau perluas radius dan budget di profilmu. Kenal calon teman sekamar? Ajak dia membuat profil; dia tetap harus lolos filter kalian berdua.
        </MatchEmptyState>
      );
    case 'TOO_NARROW': {
      const hint = data.widenHint;
      return (
        <MatchEmptyState
          icon={<Search size={40} />}
          title="Belum ada yang pas dengan filtermu"
          actions={
            <>
              {hint && hint.extra > 0 && <Button variant="primary" onClick={() => onWiden(hint.radiusKm)}>Perluas radius ke {hint.radiusKm} km: +{hint.extra} orang</Button>}
              {hasFilters && <Button variant="outline" onClick={onClear}>Hapus filter</Button>}
            </>
          }
        >
          {hint && hint.extra > 0
            ? `Dengan radius ${hint.radiusKm} km, ada ${hint.extra} mahasiswa lagi yang bisa kamu lihat.`
            : 'Coba longgarkan filter atau ubah anggaran dan radius di profilmu.'}
        </MatchEmptyState>
      );
    }
    default:
      return null;
  }
};

export const Discover: React.FC = () => (
  <MatchingShell active="cari" title="Teman Sekamar" lead="Mahasiswa terverifikasi yang cocok denganmu, diurutkan berdasarkan skor kecocokan.">
    <DiscoverList />
  </MatchingShell>
);

const DiscoverList: React.FC = () => {
  const trpc = useTRPC();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const hasFilters = ['jarak', 'min', 'maks', 'pindah'].some((k) => params.has(k));
  const input: DiscoverInput = { ...filters };

  const query = useInfiniteQuery(
    trpc.matching.discover.infiniteQueryOptions(input, { getNextPageParam: (last) => last.nextCursor ?? undefined }),
  );

  const set = (key: string, value: string | null) =>
    setParams((prev) => { const next = new URLSearchParams(prev); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const clear = () => setParams((prev) => { const next = new URLSearchParams(prev); ['jarak', 'min', 'maks', 'pindah'].forEach((k) => next.delete(k)); return next; }, { replace: true });

  const first = query.data?.pages[0];
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const showFilters = !first || first.emptyReason === null || first.emptyReason === 'TOO_NARROW' || hasFilters;

  return (
    <div className="mt-stack">
      {showFilters && first?.emptyReason !== 'NO_PROFILE' && <Filters params={params} set={set} clear={clear} active={hasFilters} />}
      {query.isPending ? (
        <div className="mt-grid" aria-busy="true" aria-label="Memuat kandidat">
          {[0, 1, 2, 3].map((i) => <CandidateCardSkeleton key={i} />)}
        </div>
      ) : query.isError && !query.data ? (
        <ErrorState message={messageForError(query.error)} onRetry={() => void query.refetch()} minHeight="14rem" />
      ) : first?.emptyReason ? (
        <EmptyByReason data={first} hasFilters={hasFilters} onWiden={(km) => set('jarak', String(km))} onClear={clear} />
      ) : (
        <>
          <p className="mt-help" role="status">{items.length} kandidat{query.hasNextPage ? ' (ada lagi)' : ''}</p>
          <div className="mt-grid">{items.map((c) => <CandidateCard key={c.profileId} candidate={c} />)}</div>
          {query.hasNextPage && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Button variant="outline" size="md" isLoading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Tampilkan lagi</Button>
            </div>
          )}
          {query.isError && <Notice tone="error">{messageForError(query.error)}</Notice>}
        </>
      )}
    </div>
  );
};
