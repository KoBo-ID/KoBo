import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OwnerDocKind } from '@kobo/shared/schemas';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { ErrorState } from '../ui/QueryState';
import { useTRPC } from '../../lib/trpc';
import { useSession } from '../../lib/session';
import { messageForError } from '../../lib/errors';
import { DOCUMENT_IMAGE_ACCEPT, prepareDocumentImage, UploadError, type DocumentImageType } from '../../lib/imageUpload';
import { recalledOwnershipType, useOwnerVerification, type OwnershipType } from '../../lib/owner';
import '../../styles/owner-form.css';

const MAX_BYTES = 10_000_000;
type DocType = DocumentImageType | 'application/pdf';
const OWNER_DOC_ACCEPT = `${DOCUMENT_IMAGE_ACCEPT},application/pdf`;

/** Labels and one-line glosses; the label wording matches OWNER_DOC_LABEL in @kobo/shared (kept local so zod stays out of the bundle). */
const KIND: Record<OwnerDocKind, { label: string; gloss: string }> = {
  KTP: { label: 'KTP', gloss: 'Foto KTP Anda yang terbaca jelas. Nama harus sama dengan akun.' },
  SHM: { label: 'SHM (Sertifikat Hak Milik)', gloss: 'Bukti hak milik tanah atas nama Anda.' },
  SHGB: { label: 'SHGB (Sertifikat Hak Guna Bangunan)', gloss: 'Bukti hak guna bangunan atas nama Anda.' },
  AJB: { label: 'AJB (Akta Jual Beli)', gloss: 'Akta jual beli dari notaris atau PPAT.' },
  GIRIK: { label: 'Girik / Letter C', gloss: 'Catatan tanah adat dari kelurahan atau desa.' },
  SPPT_PBB: { label: 'SPPT PBB', gloss: 'Tagihan pajak bumi dan bangunan atas nama Anda.' },
  SURAT_KUASA: { label: 'Surat Kuasa', gloss: 'Surat kuasa dari pemilik yang mengizinkan Anda mengelola kos.' },
  SURAT_KETERANGAN: { label: 'Surat keterangan atau perjanjian pengelolaan', gloss: 'Dari RT/RW, kelurahan, atau perjanjian dengan pemilik.' },
};
const LAND_KINDS: OwnerDocKind[] = ['SHM', 'SHGB', 'AJB', 'GIRIK', 'SPPT_PBB'];

interface Slot {
  id: string;
  title: string;
  kinds: OwnerDocKind[];
}

/** The document set the server requires for each declared role (backend/src/ownerVerification/documents.ts). */
function slotsFor(role: OwnershipType): Slot[] {
  const ktp: Slot = { id: 'ktp', title: 'KTP', kinds: ['KTP'] };
  const land: Slot = { id: 'land', title: 'Bukti kepemilikan tanah', kinds: LAND_KINDS };
  if (role === 'PENGELOLA_KUASA') return [ktp, { ...land, title: 'Dokumen tanah milik pemilik' }, { id: 'kuasa', title: 'Surat Kuasa', kinds: ['SURAT_KUASA'] }];
  if (role === 'LAINNYA') return [ktp, { id: 'ket', title: 'Surat keterangan atau perjanjian pengelolaan', kinds: ['SURAT_KETERANGAN'] }];
  return [ktp, land];
}

const DOC_STATUS: Record<'PENDING' | 'APPROVED' | 'REJECTED', string> = { PENDING: 'Diperiksa', APPROVED: 'Disetujui', REJECTED: 'Ditolak' };

type Upload = { phase: 'uploading'; name: string; progress: number } | { phase: 'done'; name: string; key: string } | { phase: 'error'; name: string; message: string; file: File | null };

/** PUT with progress (fetch has no upload progress). The headers (Content-Type) are part of the signature. */
function putWithProgress(url: string, headers: Record<string, string>, blob: Blob, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError('Penyimpanan menolak unggahan. Coba lagi beberapa saat.')));
    xhr.onerror = () => reject(new UploadError('Gagal mengunggah. Periksa koneksi Anda lalu coba lagi.'));
    xhr.send(blob);
  });
}

/**
 * Owner documents: KTP plus the land-rights document(s) for the declared role. Used as the last step of owner sign-up
 * (with `onLater`) and in the owner dashboard. A failed file never blocks the others; a rejected round only asks for the REJECTED ones.
 */
export const OwnerDocsStep: React.FC<{ onDone: () => void; onLater?: () => void }> = ({ onDone, onLater }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useSession();
  const state = useOwnerVerification();
  const presign = useMutation(trpc.ownerVerification.presign.mutationOptions());
  const submit = useMutation(trpc.ownerVerification.submit.mutationOptions());

  const role: OwnershipType = state.data?.ownershipType ?? recalledOwnershipType();
  const [uploads, setUploads] = useState<Record<string, Upload>>({});
  const [landKind, setLandKind] = useState<OwnerDocKind>('SHM');
  const [consent, setConsent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const approvedClosure = (
    <div className="odoc-closure" role="status">
      <ShieldCheck size={28} aria-hidden="true" />
      <p className="odoc-closure__text">Akun pemilik Anda sudah disetujui. Anda bisa mendaftarkan kos.</p>
      <Button variant="primary" onClick={onDone}>Ke dashboard</Button>
    </div>
  );

  if (me?.ownerStatus === 'DISETUJUI') return approvedClosure;

  if (state.isPending) {
    return (
      <div role="status" aria-live="polite" className="odoc-status">
        Memuat status dokumen…
      </div>
    );
  }
  if (state.isError) return <ErrorState message="Gagal memuat status dokumen." onRetry={() => void state.refetch()} minHeight="10rem" />;

  const st = state.data;
  const docs = st.documents;
  const sla = st.slaText;

  if (st.status === 'DISETUJUI') return approvedClosure;
  if (st.status === 'MENUNGGU') {
    return (
      <div className="odoc-closure" role="status">
        <CheckCircle2 size={28} aria-hidden="true" />
        <p className="odoc-closure__text">Dokumen terkirim. {sla}. Kami kabari lewat email.</p>
        <Button variant="primary" onClick={onDone}>Ke dashboard</Button>
      </div>
    );
  }

  const rejected = st.status === 'DITOLAK';
  const allSlots = slotsFor(role);
  const approvedKinds = new Set(docs.filter((d) => d.status === 'APPROVED').map((d) => d.kind));
  const filteredSlots = rejected ? allSlots.filter((s) => !s.kinds.some((k) => approvedKinds.has(k))) : allSlots;
  const slots = filteredSlots.length > 0 ? filteredSlots : allSlots;
  const kindOf = (s: Slot): OwnerDocKind => (s.kinds.length > 1 ? landKind : s.kinds[0]!);

  if (rejected && st.attemptsLeft <= 0) {
    return (
      <div className="odoc-stack">
        {st.reason && <Notice tone="error">Alasan penolakan: {st.reason}</Notice>}
        <DocStatusList docs={docs} />
        <Notice tone="error">Batas pengiriman dokumen sudah tercapai (sisa percobaan: 0).</Notice>
        <div className="odoc-actions">
          <Link to="/kontak" className="odoc-contact">Hubungi tim KoBo</Link>
          {onLater && <Button type="button" variant="ghost" onClick={onLater}>Nanti saja</Button>}
        </div>
      </div>
    );
  }

  const setUpload = (id: string, u: Upload | null) =>
    setUploads((prev) => {
      const next = { ...prev };
      if (u) next[id] = u;
      else delete next[id];
      return next;
    });

  const start = async (slot: Slot, file: File) => {
    const isPdf = file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name));
    if (isPdf && file.size > MAX_BYTES) return setUpload(slot.id, { phase: 'error', name: file.name, message: 'Ukuran file maksimal 10 MB.', file: null });
    setUpload(slot.id, { phase: 'uploading', name: file.name, progress: 0 });
    try {
      const prepared: { blob: Blob; contentType: DocType } = isPdf
        ? { blob: file, contentType: 'application/pdf' }
        : await prepareDocumentImage(file, MAX_BYTES);
      const p = await presign.mutateAsync({ kind: kindOf(slot), contentType: prepared.contentType, contentLength: prepared.blob.size });
      await putWithProgress(p.url, p.headers, prepared.blob, (progress) => setUpload(slot.id, { phase: 'uploading', name: file.name, progress }));
      setUpload(slot.id, { phase: 'done', name: file.name, key: p.key });
    } catch (err) {
      const retryable = !(err instanceof UploadError) || /koneksi|Penyimpanan/i.test(err.message);
      setUpload(slot.id, { phase: 'error', name: file.name, message: err instanceof UploadError ? err.message : messageForError(err), file: retryable ? file : null });
    }
  };

  const complete = slots.every((s) => uploads[s.id]?.phase === 'done');
  const busy = slots.some((s) => uploads[s.id]?.phase === 'uploading');
  const canSubmit = slots.length > 0 && complete && !busy && consent && !submit.isPending;

  const send = async () => {
    setSubmitError(null);
    const documents = slots.map((s) => {
      const u = uploads[s.id];
      return { kind: kindOf(s), key: u?.phase === 'done' ? u.key : '' };
    });
    try {
      const next = await submit.mutateAsync({ documents, consent: true });
      qc.setQueryData(trpc.ownerVerification.status.queryKey(), next);
      void qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
    } catch (err) {
      setSubmitError(messageForError(err));
    }
  };

  const hint = rejected ? 'Unggah ulang hanya dokumen yang ditolak. Dokumen yang sudah disetujui tidak perlu dikirim lagi.' : 'Unggah satu per satu. Anda bisa melengkapinya nanti dari dashboard.';

  return (
    <form className="odoc-stack" onSubmit={(e) => { e.preventDefault(); if (canSubmit) void send(); }} noValidate>
      {rejected && (
        <>
          <Notice tone="error">Dokumen ditolak{st.reason ? `: ${st.reason}` : '.'} Sisa percobaan: {st.attemptsLeft}.</Notice>
          <DocStatusList docs={docs} />
        </>
      )}

      <aside className="odoc-why" aria-labelledby="odoc-why-title">
        <h3 id="odoc-why-title" className="odoc-why__title">Kenapa kami minta ini?</h3>
        <p>Supaya kos yang tampil di KoBo nyata dan penipuan bisa dicegah. Hanya tim KoBo yang melihat. Dihapus 90 hari setelah keputusan.</p>
      </aside>

      <p className="odoc-hint">{hint}</p>
      {role === 'PEMILIK' && !rejected && <p className="odoc-hint">Tidak punya sertifikat? SPPT PBB atau Girik juga bisa.</p>}

      <ul className="odoc-list">
        {slots.map((s) => {
          const u = uploads[s.id];
          const inputId = `odoc-file-${s.id}`;
          const msgId = `odoc-msg-${s.id}`;
          const kind = kindOf(s);
          return (
            <li key={s.id} className="odoc-slot">
              <div className="odoc-slot__head">
                <FileText size={18} aria-hidden="true" />
                <span className="odoc-slot__title">{s.title}</span>
              </div>
              {s.kinds.length > 1 ? (
                <div className="odoc-slot__kind">
                  <label htmlFor={`${inputId}-kind`} className="odoc-label">Jenis dokumen</label>
                  <select id={`${inputId}-kind`} className="odoc-select" value={landKind} disabled={u?.phase === 'uploading' || submit.isPending} onChange={(e) => setLandKind(e.target.value as OwnerDocKind)}>
                    {s.kinds.map((k) => <option key={k} value={k}>{KIND[k].label}</option>)}
                  </select>
                </div>
              ) : null}
              <p className="odoc-slot__gloss">{KIND[kind].gloss}</p>
              <div className="odoc-slot__file">
                <label htmlFor={inputId} className="odoc-label">Berkas (JPG, PNG, WebP, HEIC, atau PDF, maks. 10 MB)</label>
                <input
                  id={inputId}
                  type="file"
                  accept={OWNER_DOC_ACCEPT}
                  disabled={u?.phase === 'uploading' || submit.isPending}
                  aria-invalid={u?.phase === 'error' ? true : undefined}
                  aria-describedby={u ? msgId : undefined}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void start(s, f);
                  }}
                />
              </div>
              <div id={msgId} aria-live="polite" className="odoc-slot__state">
                {u?.phase === 'uploading' && (
                  <>
                    <progress value={u.progress} max={100} aria-label={`Mengunggah ${u.name}`} />
                    <span>Mengunggah {u.name} ({u.progress}%)</span>
                  </>
                )}
                {u?.phase === 'done' && <span className="odoc-ok"><CheckCircle2 size={14} aria-hidden="true" /> {u.name} terunggah</span>}
                {u?.phase === 'error' && (
                  <>
                    <span className="odoc-err" role="alert">{u.message}</span>
                    {u.file && (
                      <Button type="button" variant="outline" size="sm" icon={<RefreshCw size={14} />} onClick={() => void start(s, u.file!)}>Coba lagi</Button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <label className="odoc-consent">
        <input type="checkbox" checked={consent} disabled={submit.isPending} onChange={(e) => setConsent(e.target.checked)} />
        <span>Saya setuju dokumen ini disimpan secara privat hanya untuk verifikasi pemilik dan dihapus 90 hari setelah keputusan.</span>
      </label>

      {submitError && <Notice tone="error">{submitError}</Notice>}

      <div className="odoc-actions">
        {onLater && <Button type="button" variant="ghost" onClick={onLater} disabled={submit.isPending}>Nanti saja</Button>}
        <Button type="submit" variant="primary" isLoading={submit.isPending} disabled={!canSubmit}>
          {rejected ? 'Kirim ulang dokumen' : 'Kirim dokumen'}
        </Button>
      </div>
      {!canSubmit && !submit.isPending && (
        <p className="odoc-hint" aria-live="polite">
          {busy ? 'Tunggu sampai unggahan selesai.' : !complete ? 'Lengkapi semua dokumen di atas untuk mengirim.' : 'Centang persetujuan untuk mengirim.'}
        </p>
      )}
    </form>
  );
};

const DocStatusList: React.FC<{ docs: { kind: OwnerDocKind; status: 'PENDING' | 'APPROVED' | 'REJECTED' }[] }> = ({ docs }) =>
  docs.length === 0 ? null : (
    <ul className="odoc-status-list" aria-label="Status dokumen">
      {docs.map((d) => (
        <li key={d.kind}>
          <span>{KIND[d.kind].label}</span>
          <span className={`odoc-badge odoc-badge--${d.status.toLowerCase()}`}>{DOC_STATUS[d.status]}</span>
        </li>
      ))}
    </ul>
  );
