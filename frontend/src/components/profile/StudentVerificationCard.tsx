import React, { useEffect, useState } from 'react';
import { GraduationCap, Mail, MailCheck, ShieldCheck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CampusVerifyMethod } from '@kobo/shared/types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { OtpInput } from '../ui/OtpInput';
import { Notice } from '../ui/Notice';
import { useSession } from '../../lib/session';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { putToStorage, UploadError } from '../../lib/imageUpload';
import { useAppStore } from '../../store/AppContext';
import { SheerIdPanel } from './SheerIdPanel';

const KTM_MAX_BYTES = 3_000_000;
const KTM_TYPES = ['image/jpeg', 'image/webp'];
const VIA_LABEL: Record<CampusVerifyMethod, string> = { EMAIL: 'email kampus', MICROSOFT: 'akun Microsoft kampus', GOOGLE: 'akun Google kampus', KTM: 'KTM', SHEERID: 'SheerID (mode uji)' };

const box: React.CSSProperties = { backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' };
const muted: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--text-muted)' };

const formatUntil = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

async function postAuth(path: string, body: unknown): Promise<string | null> {
  // Plain fetch: the better-auth client chunk is not needed for a single POST.
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { code?: string };
    return messageForError({ status: res.status, code: data.code });
  } catch (err) {
    return messageForError(err);
  }
}

/** Student verification on /profile: campus email (6-digit code), campus Microsoft/Google account, or a KTM upload as the fallback. */
export const StudentVerificationCard: React.FC = () => {
  const { me } = useSession();
  const { addToast } = useAppStore();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const refreshMe = () => qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });

  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'request' | 'confirm' | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [ktmOpen, setKtmOpen] = useState(false);
  const [campusQ, setCampusQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [nim, setNim] = useState('');
  const [nameOnCard, setNameOnCard] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [ktmBusy, setKtmBusy] = useState(false);
  const [ktmError, setKtmError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(campusQ.trim()), 250);
    return () => clearTimeout(t);
  }, [campusQ]);
  const campuses = useQuery({ ...trpc.campus.search.queryOptions({ q: debouncedQ, limit: 8 }), enabled: ktmOpen && !picked && debouncedQ.length >= 2 });
  const presign = useMutation(trpc.studentVerification.ktmPresign.mutationOptions());
  const confirmKtm = useMutation(trpc.studentVerification.ktmConfirm.mutationOptions());
  const withdraw = useMutation(trpc.studentVerification.ktmWithdraw.mutationOptions());
  const sheeridRefresh = useMutation(trpc.studentVerification.sheeridRefresh.mutationOptions());

  // Back from SheerID's hosted form (program redirect URL: /profile?sheerid=done): read the result once, then drop the flag.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sheerid') !== 'done') return;
    params.delete('sheerid');
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`);
    sheeridRefresh.mutate(undefined, {
      onSuccess: (st) => {
        addToast(st.state === 'VERIFIED' ? 'Status mahasiswa Anda terverifikasi lewat SheerID.' : 'SheerID belum memberi hasil. Cek lagi nanti.', st.state === 'VERIFIED' ? 'success' : 'info');
        void refreshMe();
      },
      onError: (err) => addToast(messageForError(err), 'error'),
    });
  }, []); // once, on arrival

  if (!me) return null;
  const sv = me.studentVerification;
  const verified = !!me.campusVerified;
  const isDemo = me.user.isDemo;

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('request');
    setEmailError(null);
    const target = email.trim();
    const err = await postAuth('/api/auth/campus-email/request', { email: target });
    setBusy(null);
    if (err) return setEmailError(err);
    setSentTo(target.toLowerCase());
    setCode('');
  };

  const confirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('confirm');
    setEmailError(null);
    const err = await postAuth('/api/auth/campus-email/confirm', { code: code.trim() });
    setBusy(null);
    if (err) return setEmailError(err);
    setSentTo(null);
    addToast('Status mahasiswa Anda terverifikasi.', 'success');
    await refreshMe();
  };

  const submitKtm = async (e: React.FormEvent) => {
    e.preventDefault();
    setKtmError(null);
    if (!picked) return setKtmError('Pilih kampus Anda dari daftar.');
    if (!file) return setKtmError('Pilih foto KTM.');
    if (!KTM_TYPES.includes(file.type)) return setKtmError('Foto KTM harus berformat JPEG atau WebP.');
    if (file.size > KTM_MAX_BYTES) return setKtmError('Foto KTM maksimal 3 MB.');
    if (!consent) return setKtmError('Centang persetujuan penyimpanan foto KTM.');
    setKtmBusy(true);
    try {
      const p = await presign.mutateAsync({ contentType: file.type as 'image/jpeg' | 'image/webp', contentLength: file.size });
      await putToStorage(p.url, p.headers, file);
      await confirmKtm.mutateAsync({ key: p.key, campusId: picked.id, nim: nim.trim(), nameOnCard: nameOnCard.trim(), consent: true });
      await refreshMe();
      setKtmOpen(false);
      setFile(null);
      addToast('KTM terkirim dan sedang ditinjau.', 'success');
    } catch (err) {
      setKtmError(err instanceof UploadError ? err.message : messageForError(err));
    } finally {
      setKtmBusy(false);
    }
  };

  const doWithdraw = async () => {
    try {
      await withdraw.mutateAsync();
      await refreshMe();
      addToast('Pengajuan KTM ditarik dan foto dihapus.', 'success');
    } catch (err) {
      addToast(messageForError(err), 'error');
    }
  };

  let status: React.ReactNode = null;
  if (sv.state === 'VERIFIED' || verified) {
    status = (
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
        <ShieldCheck size={18} color="var(--primary)" style={{ flexShrink: 0, marginTop: '0.1rem' }} aria-hidden="true" />
        <span role="status" style={{ fontSize: '0.85rem', fontWeight: 700, overflowWrap: 'anywhere' }}>
          Terverifikasi lewat {sv.via ? VIA_LABEL[sv.via] : 'verifikasi mahasiswa'}
          {me.user.campusEmail && sv.via === 'EMAIL' ? ` ${me.user.campusEmail}` : ''}
          {sv.campus ? ` (${sv.campus})` : ''}
          {sv.until ? ` · berlaku sampai ${formatUntil(sv.until)}` : ''}
        </span>
      </div>
    );
  } else if (sv.state === 'PENDING') {
    status = <Notice tone="success">KTM sedang ditinjau</Notice>;
  } else if (sv.state === 'REJECTED') {
    status = <Notice tone="error">Ditolak: {sv.reason ?? 'tidak ada alasan yang dicatat'}</Notice>;
  } else if (sv.state === 'EXPIRED') {
    status = <Notice tone="error">Verifikasi kedaluwarsa, perbarui</Notice>;
  }

  const showActions = !isDemo && !verified && sv.state !== 'PENDING';

  return (
    <section data-testid="student-verification" aria-labelledby="student-verif-title" style={{ backgroundColor: verified ? 'var(--primary-light)' : 'var(--bg-page)', border: `1.5px solid ${verified ? 'var(--primary)' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-lg)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
        <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: verified ? 'var(--primary)' : 'var(--bg-muted)', color: verified ? 'white' : 'var(--text-muted)' }}>
          <GraduationCap size={22} />
        </div>
        <div>
          <h2 id="student-verif-title" style={{ fontSize: '1rem', fontWeight: 700 }}>Verifikasi status mahasiswa</h2>
          <p style={muted}>KoBo khusus mahasiswa. Verifikasi sekali untuk mengajukan sewa, menjadwalkan survey, dan masuk daftar tunggu.</p>
        </div>
      </div>

      {status}
      {isDemo && <p style={muted}>Verifikasi tidak tersedia untuk akun demo.</p>}

      {sv.state === 'PENDING' && !isDemo && (
        <div>
          <Button variant="outline" size="sm" isLoading={withdraw.isPending} onClick={() => void doWithdraw()}>Tarik pengajuan</Button>
        </div>
      )}

      {showActions && (
        <>
          {sentTo ? (
            <form onSubmit={(e) => void confirmCode(e)} style={box}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <MailCheck size={18} color="var(--primary)" style={{ flexShrink: 0, marginTop: '0.1rem' }} aria-hidden="true" />
                <span role="status" style={{ fontSize: '0.85rem', fontWeight: 700, overflowWrap: 'anywhere' }}>Kode dikirim ke {sentTo}</span>
              </div>
              {emailError && <Notice tone="error">{emailError}</Notice>}
              <OtpInput label="Kode 6 digit" value={code} onChange={setCode} helperText="Kode berlaku 10 menit." autoFocus />
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setSentTo(null); setEmailError(null); }}>Gunakan email lain / kirim ulang</Button>
                <Button type="submit" variant="primary" size="sm" isLoading={busy === 'confirm'} disabled={code.length !== 6 || busy !== null}>Verifikasi</Button>
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => void requestCode(e)} style={box}>
              {emailError && <Notice tone="error">{emailError}</Notice>}
              <Input label="Email Kampus" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@binus.ac.id" helperText="Email mahasiswa dari kampus Anda. Kami kirim kode 6 digit." iconLeft={<Mail size={16} />} autoComplete="email" required />
              <Button type="submit" variant="primary" size="sm" isLoading={busy === 'request'} disabled={busy !== null} style={{ alignSelf: 'flex-end' }}>Kirim kode</Button>
            </form>
          )}

          {(sv.providers.microsoft || sv.providers.google) && (
            <div className="student-verif__methods">
              {sv.providers.microsoft && <Button variant="outline" size="sm" onClick={() => window.location.assign('/api/auth/campus-idp/start?provider=microsoft')}>Verifikasi dengan Microsoft kampus</Button>}
              {sv.providers.google && <Button variant="outline" size="sm" onClick={() => window.location.assign('/api/auth/campus-idp/start?provider=google')}>Verifikasi dengan Google kampus</Button>}
            </div>
          )}

          {sv.providers.sheerid && <SheerIdPanel />}

          {!ktmOpen ? (
            <button type="button" className="student-verif__link" onClick={() => setKtmOpen(true)}>Tidak punya email atau akun kampus? Unggah KTM</button>
          ) : (
            <form onSubmit={(e) => void submitKtm(e)} style={box} aria-label="Unggah KTM">
              {ktmError && <Notice tone="error">{ktmError}</Notice>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <Input label="Kampus" value={picked ? picked.name : campusQ} onChange={(e) => { setPicked(null); setCampusQ(e.target.value); }} placeholder="Cari nama kampus" autoComplete="off" required />
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
              <Input label="NIM" value={nim} onChange={(e) => setNim(e.target.value)} minLength={3} maxLength={30} required />
              <Input label="Nama di KTM" value={nameOnCard} onChange={(e) => setNameOnCard(e.target.value)} minLength={2} maxLength={80} required />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label htmlFor="ktm-file" style={{ fontSize: '0.875rem', fontWeight: 600 }}>Foto KTM (JPEG atau WebP, maksimal 3 MB)</label>
                <input id="ktm-file" type="file" accept="image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
              </div>
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.82rem' }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: '0.2rem' }} />
                <span>Saya setuju foto KTM disimpan secara privat hanya untuk verifikasi status mahasiswa dan dihapus 30 hari setelah keputusan.</span>
              </label>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setKtmOpen(false)}>Batal</Button>
                <Button type="submit" variant="primary" size="sm" isLoading={ktmBusy} disabled={ktmBusy}>Kirim KTM</Button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
};
