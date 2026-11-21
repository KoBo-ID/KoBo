import React, { useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock, Mail, ShieldCheck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { OtpInput } from '../ui/OtpInput';
import { Notice } from '../ui/Notice';
import { useSession } from '../../lib/session';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { putToStorage, UploadError } from '../../lib/imageUpload';
import { useAppStore } from '../../store/AppContext';

const KTM_MAX_BYTES = 3_000_000;
const KTM_TYPES = ['image/jpeg', 'image/webp'];
const MAX_ATTEMPTS = 3;
const DRAFT_KEY = 'kobo.signup.ktm';

interface Draft {
  campus: { id: string; name: string } | null;
  nameOnCard: string;
  nim: string;
  program: string;
  validUntil: string;
}
const EMPTY_DRAFT: Draft = { campus: null, nameOnCard: '', nim: '', program: '', validUntil: '' };

function readDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}
/** Text fields only: never the photo. Cleared on finish and on sign-out. */
export function clearKtmDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Where "Cari kos" goes: the page the student came from, or the search page. */
export const searchTarget = (next: string): string => (next === '/' ? '/search' : next);

/** Plain fetch: the campus-email endpoints need no better-auth client chunk. */
async function postAuth(path: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { code?: string };
    return messageForError({ status: res.status, code: data.code });
  } catch (err) {
    return messageForError(err);
  }
}

/** Shown while a KTM waits for review (step 3 and the completion screen). */
export const StudentPendingCard: React.FC<{ slaText: string; next: string }> = ({ slaText, next }) => {
  const navigate = useNavigate();
  return (
  <div className="auth-step__card" role="status" data-testid="ktm-pending">
    <p style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', margin: 0, fontWeight: 700 }}>
      <Clock size={18} color="var(--primary)" aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.15rem' }} />
      <span>Dokumen sedang diperiksa · {slaText}. Anda tidak perlu menunggu di sini; kami kirim email.</span>
    </p>
    <Button variant="primary" fullWidth onClick={() => navigate(searchTarget(next))}>Cari kos sambil menunggu</Button>
  </div>
  );
};

/** Verification by campus email code or campus Microsoft/Google login (the "Cara lain" disclosure). */
const OtherWays: React.FC<{ defaultOpen: boolean }> = ({ defaultOpen }) => {
  const { me } = useSession();
  const { addToast } = useAppStore();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'request' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const providers = me?.studentVerification.providers;

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('request');
    setError(null);
    const target = email.trim();
    const err = await postAuth('/api/auth/campus-email/request', { email: target });
    setBusy(null);
    if (err) return setError(err);
    setSentTo(target.toLowerCase());
    setCode('');
  };
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('confirm');
    setError(null);
    const err = await postAuth('/api/auth/campus-email/confirm', { code: code.trim() });
    setBusy(null);
    if (err) {
      setCode('');
      return setError(err);
    }
    setSentTo(null);
    addToast('Status mahasiswa Anda terverifikasi.', 'success');
    await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
  };

  return (
    <details className="auth-step__other" open={defaultOpen}>
      <summary>Cara lain</summary>
      <div className="auth-step__card" style={{ marginTop: '0.6rem' }}>
        {error && <Notice tone="error">{error}</Notice>}
        {sentTo ? (
          <form onSubmit={(e) => void confirm(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p className="auth-step__muted" role="status">Kode dikirim ke <strong>{sentTo}</strong>.</p>
            <OtpInput label="Kode 6 digit" value={code} onChange={setCode} helperText="Kode berlaku 10 menit." autoFocus />
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setSentTo(null); setError(null); }}>Gunakan email lain</Button>
              <Button type="submit" variant="primary" size="sm" isLoading={busy === 'confirm'} disabled={code.length !== 6 || busy !== null}>Verifikasi</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={(e) => void request(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Input label="Email kampus" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@kampus.ac.id" helperText="Kami kirim kode 6 digit ke email mahasiswa Anda." iconLeft={<Mail size={16} />} autoComplete="email" required />
            <Button type="submit" variant="primary" size="sm" isLoading={busy === 'request'} disabled={busy !== null} style={{ alignSelf: 'flex-end' }}>Kirim kode</Button>
          </form>
        )}
        {(providers?.microsoft || providers?.google) && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {providers.microsoft && <Button variant="outline" size="sm" onClick={() => window.location.assign('/api/auth/campus-idp/start?provider=microsoft')}>Masuk dengan Microsoft kampus</Button>}
            {providers.google && <Button variant="outline" size="sm" onClick={() => window.location.assign('/api/auth/campus-idp/start?provider=google')}>Masuk dengan Google kampus</Button>}
          </div>
        )}
      </div>
    </details>
  );
};

interface StudentVerifyStepProps {
  /** Safe path the student came from; "Cari kos" returns there. */
  next: string;
  /** The KTM went in (or the student is already verified): move on to the completion screen. */
  onContinue: () => void;
  /** "Nanti saja": the caller sends the student on to `next` or /search. */
  onLater: () => void;
}

type FieldKey = 'campus' | 'name' | 'nim' | 'file' | 'consent' | 'form';

/** Step 3 of student sign-up: KTM details and photo, or the status of an earlier submission. */
export const StudentVerifyStep: React.FC<StudentVerifyStepProps> = ({ next, onContinue, onLater }) => {
  const { me } = useSession();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const uid = useId();
  const listId = `${uid}-campus`;

  const [draft, setDraft] = useState<Draft>(() => readDraft());
  const restored = useMemo(() => !!(draft.campus || draft.nim || draft.nameOnCard), []); // eslint-disable-line react-hooks/exhaustive-deps -- only the first render matters
  const [campusQ, setCampusQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [listOpen, setListOpen] = useState(true);
  const [active, setActive] = useState(-1);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage unavailable */
    }
  }, [draft]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(campusQ.trim()), 250);
    return () => clearTimeout(t);
  }, [campusQ]);
  // A fresh account has no display name for the card yet: default to the account name.
  useEffect(() => {
    if (me && !draft.nameOnCard) set({ nameOnCard: me.user.name });
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps -- prefill once the session is known

  const campuses = useQuery({ ...trpc.campus.search.queryOptions({ q: debouncedQ, limit: 8 }), enabled: !draft.campus && debouncedQ.length >= 2 });
  const affiliations = useQuery({ ...trpc.campus.affiliations.queryOptions(), staleTime: 5 * 60_000 });
  const mitra = useMemo(() => new Set((affiliations.data ?? []).map((a) => a.campusId)), [affiliations.data]);
  const presign = useMutation(trpc.studentVerification.ktmPresign.mutationOptions());
  const confirmKtm = useMutation(trpc.studentVerification.ktmConfirm.mutationOptions());

  if (!me) return null;
  const sv = me.studentVerification;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const used = Math.min(MAX_ATTEMPTS, MAX_ATTEMPTS - sv.attemptsLeft);
  const exhausted = sv.state !== 'PENDING' && sv.attemptsLeft <= 0;
  const results = campuses.data ?? [];
  const listVisible = listOpen && !draft.campus && results.length > 0;
  const fail = (key: FieldKey, msg: string) => setErrors({ [key]: msg });
  const pick = (c: { id: string; name: string }) => { set({ campus: { id: c.id, name: c.name } }); setActive(-1); };

  if (me.campusVerified || sv.state === 'VERIFIED') {
    return (
      <div className="auth-step">
        <div className="auth-step__card" role="status">
          <p style={{ display: 'flex', gap: '0.5rem', margin: 0, fontWeight: 700 }}>
            <ShieldCheck size={18} color="var(--primary)" aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.15rem' }} />
            Status mahasiswa Anda sudah terverifikasi{sv.campus ? ` (${sv.campus})` : ''}.
          </p>
        </div>
        <Button variant="primary" fullWidth onClick={onContinue}>Lanjut</Button>
      </div>
    );
  }
  if (me.user.isDemo) {
    return (
      <div className="auth-step">
        <p className="auth-step__muted">Akun demo tidak perlu verifikasi mahasiswa.</p>
        <Button variant="primary" fullWidth onClick={onLater}>Cari kos</Button>
      </div>
    );
  }
  if (sv.state === 'PENDING') {
    return (
      <div className="auth-step">
        <StudentPendingCard slaText={sv.slaText} next={next} />
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    const nim = draft.nim.trim();
    const name = draft.nameOnCard.trim();
    if (!draft.campus) return fail('campus', 'Pilih kampus Anda dari daftar.');
    if (name.length < 2) return fail('name', 'Isi nama lengkap sesuai KTM.');
    if (nim.length < 3) return fail('nim', 'Isi NIM sesuai KTM (minimal 3 karakter).');
    if (draft.validUntil && draft.validUntil < today) return fail('form', 'Masa berlaku KTM sudah lewat. Gunakan KTM yang masih berlaku atau kartu rencana studi semester ini.');
    if (!file) return fail('file', restored ? 'Unggah ulang foto KTM Anda.' : 'Pilih foto KTM.');
    if (!KTM_TYPES.includes(file.type)) return fail('file', 'Foto KTM harus berformat JPEG atau WebP.');
    if (file.size > KTM_MAX_BYTES) return fail('file', 'Foto KTM maksimal 3 MB.');
    if (!consent) return fail('consent', 'Centang persetujuan penyimpanan foto KTM.');
    setBusy(true);
    try {
      const p = await presign.mutateAsync({ contentType: file.type as 'image/jpeg' | 'image/webp', contentLength: file.size });
      await putToStorage(p.url, p.headers, file);
      await confirmKtm.mutateAsync({
        key: p.key,
        campusId: draft.campus.id,
        nim,
        nameOnCard: name,
        consent: true,
        ...(draft.validUntil ? { validUntil: draft.validUntil } : {}),
        ...(draft.program.trim() ? { program: draft.program.trim() } : {}),
      });
      await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      clearKtmDraft();
      setFile(null);
      onContinue();
    } catch (err) {
      fail('form', err instanceof UploadError ? err.message : messageForError(err));
    } finally {
      setBusy(false);
    }
  };

  const errId = (k: FieldKey) => (errors[k] ? `${uid}-err-${k}` : undefined);
  const fieldError = (k: FieldKey) => errors[k] && <span id={errId(k)} role="alert" style={{ fontSize: 'var(--step--1)', color: 'var(--danger, #b91c1c)' }}>{errors[k]}</span>;

  return (
    <div className="auth-step">
      {sv.state === 'REJECTED' && !exhausted && (
        <Notice tone="error">
          <strong>Percobaan {used} dari {MAX_ATTEMPTS}.</strong> {sv.reason ?? 'KTM belum dapat diterima.'} Unggah ulang foto yang sudah diperbaiki.
        </Notice>
      )}
      {sv.state === 'EXPIRED' && <Notice tone="error">Verifikasi Anda kedaluwarsa. Verifikasi ulang dengan KTM terbaru.</Notice>}

      {exhausted ? (
        <>
          <Notice tone="error">
            <strong>Batas percobaan tercapai.</strong> Gunakan "Cara lain" di bawah (email kampus atau akun kampus), atau <Link to="/kontak" style={{ color: 'var(--primary)', fontWeight: 700 }}>hubungi kami</Link>.
          </Notice>
          <OtherWays defaultOpen />
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="auth-step__card" aria-label="Verifikasi mahasiswa dengan KTM">
          {errors.form && <Notice tone="error">{errors.form}</Notice>}
          {restored && <p className="auth-step__muted" role="status">Data Anda dipulihkan. Unggah ulang foto KTM.</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <Input
              label="Kampus"
              value={draft.campus ? draft.campus.name : campusQ}
              onChange={(e) => { set({ campus: null }); setCampusQ(e.target.value); setListOpen(true); setActive(-1); }}
              onKeyDown={(e) => {
                const n = results.length;
                if (e.key === 'ArrowDown' && listVisible) { e.preventDefault(); setActive((i) => (i + 1) % n); }
                else if (e.key === 'ArrowUp' && listVisible) { e.preventDefault(); setActive((i) => (i <= 0 ? n - 1 : i - 1)); }
                else if (e.key === 'Enter' && listVisible && active >= 0) { e.preventDefault(); const c = results[active]; if (c) pick(c); }
                else if (e.key === 'Escape' && listVisible) { e.preventDefault(); setListOpen(false); setActive(-1); }
              }}
              placeholder="Cari nama kampus"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={listVisible}
              aria-controls={listId}
              aria-activedescendant={listVisible && active >= 0 ? `${listId}-${active}` : undefined}
              aria-invalid={errors.campus ? true : undefined}
              aria-describedby={errId('campus')}
            />
            <div id={listId} role="listbox" aria-label="Hasil pencarian kampus" hidden={!listVisible} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              {listVisible && results.map((c, i) => (
                <div role="option" id={`${listId}-${i}`} aria-selected={i === active} key={c.id} className="auth-step__option" style={i === active ? { backgroundColor: 'var(--primary-light)' } : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
                  <span>{c.name}</span>
                  <span className="auth-step__muted">· {c.city}</span>
                  {mitra.has(c.id) && <span className="auth-step__tag">Kampus Mitra</span>}
                </div>
              ))}
            </div>
            {draft.campus && mitra.has(draft.campus.id) && <span className="auth-step__tag" style={{ alignSelf: 'flex-start', marginLeft: 0 }}>Kampus Mitra</span>}
            {!draft.campus && debouncedQ.length >= 2 && !campuses.isFetching && results.length === 0 && <span role="status" className="auth-step__muted">Kampus tidak ditemukan.</span>}
            {fieldError('campus')}
            <p className="auth-step__muted">Kampus lain tetap bisa menyewa, tanpa Diskon Kampus Mitra.</p>
          </div>

          <Input label="Nama lengkap sesuai KTM" value={draft.nameOnCard} onChange={(e) => set({ nameOnCard: e.target.value })} maxLength={80} autoComplete="name" error={errors.name} />
          <Input label="NIM" value={draft.nim} onChange={(e) => set({ nim: e.target.value })} inputMode="numeric" maxLength={30} autoComplete="off" error={errors.nim} />
          <Input label="Program studi (opsional)" value={draft.program} onChange={(e) => set({ program: e.target.value })} maxLength={80} autoComplete="off" />
          <Input label="Masa berlaku KTM" type="date" value={draft.validUntil} min={today} onChange={(e) => set({ validUntil: e.target.value })} helperText="Jika tertera di kartu. Boleh dikosongkan." />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label htmlFor={`${uid}-file`} style={{ fontSize: 'var(--step--1)', fontWeight: 600 }}>Foto KTM (JPEG atau WebP, maksimal 3 MB)</label>
            <input id={`${uid}-file`} type="file" accept="image/jpeg,image/webp" aria-invalid={errors.file ? true : undefined} aria-describedby={errId('file')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {fieldError('file')}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: 'var(--step--1)', lineHeight: 1.5 }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={errors.consent ? true : undefined} aria-describedby={errId('consent')} style={{ marginTop: '0.25rem' }} />
              <span>Saya setuju foto KTM disimpan secara privat hanya untuk verifikasi status mahasiswa dan dihapus 30 hari setelah keputusan.</span>
            </label>
            {fieldError('consent')}
          </div>

          <Button type="submit" variant="primary" fullWidth isLoading={busy} disabled={busy}>Kirim untuk diperiksa</Button>
        </form>
      )}

      {!exhausted && <OtherWays defaultOpen={false} />}

      <Button type="button" variant="ghost" fullWidth disabled={busy} onClick={onLater}>Nanti saja</Button>
    </div>
  );
};
