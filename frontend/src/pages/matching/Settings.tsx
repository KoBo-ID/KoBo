import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ErrorState } from '../../components/ui/QueryState';
import { Notice } from '../../components/ui/Notice';
import { Skeleton } from '../../components/ui/Skeleton';
import { MatchEmptyState } from '../../components/matching/EmptyState';
import { MatchingShell } from '../../components/matching/MatchingShell';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { MATCH_BASE, useInvalidateMatching, useMatchingProfile } from '../../lib/matching';
import '../../styles/matching.css';

export const Settings: React.FC = () => (
  <MatchingShell active="pengaturan" title="Pengaturan Teman Sekamar">
    <SettingsBody />
  </MatchingShell>
);

type Confirm = 'found' | 'delete' | null;

const SettingsBody: React.FC = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const invalidate = useInvalidateMatching();
  const profile = useMatchingProfile();
  const blocks = useQuery({ ...trpc.matching.safety.blocks.queryOptions(), retry: false });
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const onError = (e: unknown) => { setConfirm(null); setNotice({ tone: 'error', text: messageForError(e) }); };
  const done = (text: string) => () => { setConfirm(null); setNotice({ tone: 'success', text }); void invalidate(); };

  const setActive = useMutation({ ...trpc.matching.profile.setActive.mutationOptions(), onSuccess: () => { setNotice(null); void invalidate(); }, onError });
  const markFound = useMutation({ ...trpc.matching.profile.markFound.mutationOptions(), onSuccess: done('Pencarianmu dijeda dan permintaan yang menunggu dibatalkan. Koneksi yang sudah ada tetap aktif.'), onError });
  const optOut = useMutation({ ...trpc.matching.profile.setEmailOptOut.mutationOptions(), onSuccess: () => { setNotice(null); void invalidate(); }, onError });
  const unblock = useMutation({ ...trpc.matching.safety.unblock.mutationOptions(), onSuccess: done('Blokir dibuka. Koneksi yang dulu diakhiri tidak dipulihkan.'), onError });
  const remove = useMutation({
    ...trpc.matching.profile.delete.mutationOptions(),
    onSuccess: () => { void invalidate(); navigate(MATCH_BASE); },
    onError,
  });

  if (profile.isPending) return <div className="mt-stack" aria-busy="true" aria-label="Memuat pengaturan"><Skeleton height="6rem" borderRadius="var(--radius-lg)" /><Skeleton height="6rem" borderRadius="var(--radius-lg)" /></div>;
  if (profile.isError) return <ErrorState message={messageForError(profile.error)} onRetry={() => void profile.refetch()} minHeight="12rem" />;
  const me = profile.data;
  if (!me) {
    return (
      <MatchEmptyState title="Kamu belum punya profil" actions={<ButtonLink to={`${MATCH_BASE}/profil`} variant="primary">Buat profil</ButtonLink>}>
        Pengaturan tersedia setelah kamu membuat profil Teman Sekamar.
      </MatchEmptyState>
    );
  }

  const running = me.active && !me.pausedAt;
  const busy = setActive.isPending || markFound.isPending || optOut.isPending || remove.isPending;

  return (
    <div className="mt-stack">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {me.hiddenByReportsAt && <Notice tone="error">Profilmu disembunyikan sementara karena laporan dan sedang ditinjau. Kamu tidak muncul di pencarian orang lain.</Notice>}

      <section className="mt-card" aria-labelledby="set-aktif">
        <div className="mt-switch">
          <div className="mt-switch__text">
            <h2 id="set-aktif" className="mt-section-title">Profil aktif</h2>
            <p className="mt-help">
              {running
                ? 'Profilmu muncul di pencarian dan kamu bisa mengirim permintaan. Menonaktifkan membatalkan permintaan yang masih menunggu.'
                : me.pausedAt ? 'Pencarianmu sedang dijeda. Aktifkan lagi kalau kamu mulai mencari.' : 'Profilmu tersembunyi dari pencarian.'}
            </p>
          </div>
          <input
            type="checkbox"
            role="switch"
            aria-labelledby="set-aktif"
            checked={running}
            disabled={busy || !!me.hiddenByReportsAt}
            onChange={(e) => setActive.mutate({ active: e.target.checked })}
          />
        </div>
      </section>

      <section className="mt-card mt-stack" aria-labelledby="set-found">
        <div>
          <h2 id="set-found" className="mt-section-title">Sudah dapat teman sekamar</h2>
          <p className="mt-help">Jeda pencarian: profilmu disembunyikan dan permintaan yang menunggu dibatalkan. Koneksi dan obrolan yang sudah ada tetap jalan.</p>
        </div>
        <div><Button variant="outline" size="md" disabled={busy || !!me.pausedAt} onClick={() => setConfirm('found')}>{me.pausedAt ? 'Pencarian sudah dijeda' : 'Sudah dapat teman sekamar'}</Button></div>
      </section>

      <section className="mt-card" aria-labelledby="set-email">
        <div className="mt-switch">
          <div className="mt-switch__text">
            <h2 id="set-email" className="mt-section-title">Email pemberitahuan</h2>
            <p className="mt-help">Email saat ada permintaan baru, permintaan diterima, dan ringkasan pesan (tanpa isi pesan). Notifikasi di dalam aplikasi tetap tampil.</p>
          </div>
          <input
            type="checkbox"
            role="switch"
            aria-labelledby="set-email"
            checked={!me.emailOptOut}
            disabled={busy}
            onChange={(e) => optOut.mutate({ emailOptOut: !e.target.checked })}
          />
        </div>
      </section>

      <section className="mt-card" aria-labelledby="set-blok">
        <h2 id="set-blok" className="mt-section-title">Daftar blokir</h2>
        {blocks.isPending ? <Skeleton height="3rem" /> : blocks.isError ? (
          <ErrorState message={messageForError(blocks.error)} onRetry={() => void blocks.refetch()} minHeight="6rem" />
        ) : blocks.data.length === 0 ? (
          <p className="mt-help">Kamu belum memblokir siapa pun.</p>
        ) : (
          <>
            <ul className="mt-list">
              {blocks.data.map((b) => (
                <li key={b.id}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontWeight: 600 }}>{b.displayName}</span>
                  <Button variant="outline" size="sm" isLoading={unblock.isPending && unblock.variables?.blockId === b.id} disabled={unblock.isPending} onClick={() => unblock.mutate({ blockId: b.id })}>Buka blokir</Button>
                </li>
              ))}
            </ul>
            <p className="mt-help" style={{ marginTop: 'var(--space-2xs)' }}>Membuka blokir tidak memulihkan koneksi yang sudah berakhir.</p>
          </>
        )}
      </section>

      <section className="mt-card mt-stack" aria-labelledby="set-hapus">
        <div>
          <h2 id="set-hapus" className="mt-section-title">Hapus profil</h2>
          <p className="mt-help">Menghapus profil membatalkan semua permintaan dan mengakhiri semua koneksi. Namamu di obrolan lama menjadi &quot;Pengguna KoBo&quot;. Kalau hanya butuh istirahat, nonaktifkan saja.</p>
        </div>
        <div><Button variant="danger" size="md" disabled={busy} onClick={() => setConfirm('delete')}>Hapus profil</Button></div>
      </section>

      {confirm === 'found' && (
        <ConfirmDialog
          title="Sudah dapat teman sekamar?"
          message="Profilmu dijeda dan semua permintaan yang masih menunggu (terkirim maupun diterima) dibatalkan. Koneksi yang sudah ada tidak berubah. Kamu bisa mengaktifkan profil lagi kapan saja."
          confirmLabel="Jeda pencarian"
          busy={markFound.isPending}
          onConfirm={() => markFound.mutate({})}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title="Hapus profil Teman Sekamar?"
          message="Profilmu hilang dari pencarian, semua permintaan dibatalkan dan semua koneksi diakhiri. Orang lain melihat namamu sebagai &quot;Pengguna KoBo&quot; di obrolan lama. Ini tidak bisa dibatalkan; kamu harus membuat profil baru untuk mencari lagi."
          confirmLabel="Hapus profil"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
};
