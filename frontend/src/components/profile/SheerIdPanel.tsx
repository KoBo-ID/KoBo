import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';

const box: React.CSSProperties = { backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' };
const muted: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--text-muted)' };

/**
 * SheerID verification, DEV/TEST ONLY: the server offers it only when SHEERID_ENABLED=1 and refuses it in production
 * (backend/src/sheerid.ts). The program runs in SheerID Test Mode, so the copy tells the tester not to enter real data.
 */
export const SheerIdPanel: React.FC = () => {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const campuses = useQuery({ ...trpc.campus.search.queryOptions({ q: debouncedQ, limit: 8 }), enabled: open && !picked && debouncedQ.length >= 2 });
  const start = useMutation(trpc.studentVerification.sheeridStart.mutationOptions());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!picked) return setError('Pilih kampus Anda dari daftar.');
    if (!consent) return setError('Centang persetujuan pengiriman data ke SheerID.');
    try {
      const { url } = await start.mutateAsync({ campusId: picked.id, consent: true });
      window.location.assign(url);
    } catch (err) {
      setError(messageForError(err));
    }
  };

  if (!open) {
    return <button type="button" className="student-verif__link" onClick={() => setOpen(true)}>Verifikasi lewat SheerID (mode uji)</button>;
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={box} aria-label="Verifikasi lewat SheerID">
      <Notice tone="error">Mode uji pengembangan. Jangan masukkan data atau dokumen asli. Gunakan nama uji dan dokumen contoh dari SheerID.</Notice>
      {error && <Notice tone="error">{error}</Notice>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <Input label="Kampus" value={picked ? picked.name : q} onChange={(e) => { setPicked(null); setQ(e.target.value); }} placeholder="Cari nama kampus" autoComplete="off" required />
        {!picked && (campuses.data?.length ?? 0) > 0 && (
          <div role="listbox" aria-label="Hasil pencarian kampus" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {campuses.data!.map((c) => (
              <button type="button" role="option" aria-selected={false} key={c.id} className="student-verif__option" onClick={() => setPicked({ id: c.id, name: c.name })}>
                {c.name} <span style={muted}>· {c.city}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p style={muted}>
        Data yang kamu isi di formulir SheerID (nama, email, tanggal lahir, kampus, dan dokumen kuliah tanpa foto wajah) dikirim ke SheerID, Inc. di Amerika Serikat untuk diperiksa.
        KoBo hanya menerima hasilnya, lalu meminta SheerID menghapus datamu begitu hasil keluar.
      </p>
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.82rem' }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: '0.2rem' }} />
        <span>Saya setuju data verifikasi saya dikirim ke SheerID (Amerika Serikat) hanya untuk memeriksa status mahasiswa.</span>
      </label>
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Batal</Button>
        <Button type="submit" variant="primary" size="sm" isLoading={start.isPending} disabled={start.isPending}>Lanjut ke SheerID</Button>
      </div>
    </form>
  );
};
