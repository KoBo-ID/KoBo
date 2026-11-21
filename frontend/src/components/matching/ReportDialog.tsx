import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Notice } from '../ui/Notice';
import { useTRPC } from '../../lib/trpc';
import { refusalMessage, useInvalidateMatching } from '../../lib/matching';
import '../../styles/matching.css';

type Reason = 'PELECEHAN' | 'SPAM_PENIPUAN' | 'PROFIL_PALSU' | 'KONTEN_TIDAK_PANTAS' | 'LAINNYA';
// Mirrors REPORT_REASON_LABEL in @kobo/shared/schemas (kept local so the Zod schemas stay out of this chunk).
const REASONS: { id: Reason; label: string; hint?: string }[] = [
  { id: 'PELECEHAN', label: 'Pelecehan' },
  { id: 'SPAM_PENIPUAN', label: 'Spam atau penipuan' },
  { id: 'PROFIL_PALSU', label: 'Profil palsu', hint: 'termasuk gender tidak sesuai' },
  { id: 'KONTEN_TIDAK_PANTAS', label: 'Konten tidak pantas' },
  { id: 'LAINNYA', label: 'Lainnya' },
];
const MAX = 500;

/**
 * Report dialog (the submit button is the confirmation). Props: `profileId` and `displayName` of the reported person; `onClose`;
 * optional `connectionId` / `messageId` when reporting from a chat (the server stores the last 50 messages as evidence).
 * After a PELECEHAN report it shows where to get help (Komnas Perempuan, police under UU TPKS).
 */
export const ReportDialog: React.FC<{
  profileId: string;
  displayName: string;
  connectionId?: string;
  messageId?: string;
  onClose: () => void;
}> = ({ profileId, displayName, connectionId, messageId, onClose }) => {
  const trpc = useTRPC();
  const invalidate = useInvalidateMatching();
  const [reason, setReason] = useState<Reason | null>(null);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Reason | null>(null);
  const report = useMutation({
    ...trpc.matching.safety.report.mutationOptions(),
    onSuccess: (_d, vars) => { setSent(vars.reason); void invalidate(); },
    onError: (e) => setError(refusalMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) { setError('Pilih alasan laporan dulu.'); return; }
    setError(null);
    report.mutate({ profileId, reason, detail: detail.trim(), ...(connectionId ? { connectionId } : {}), ...(messageId ? { messageId } : {}) });
  };

  return (
    <Modal isOpen onClose={onClose} title={sent ? 'Laporan terkirim' : `Laporkan ${displayName}`} maxWidth="sm">
      {sent ? (
        <div className="mt-stack">
          <p>Terima kasih. Laporanmu kami tinjau; identitasmu tidak diberitahukan ke orang yang dilaporkan.</p>
          {sent === 'PELECEHAN' && (
            <Notice tone="success">
              Jika kamu mengalami kekerasan atau pelecehan, kamu tidak sendirian. Kamu bisa menghubungi Komnas Perempuan (komnasperempuan.go.id) atau melapor ke kepolisian; kekerasan seksual adalah tindak pidana menurut UU TPKS. Orang ini otomatis disembunyikan darimu.
            </Notice>
          )}
          <div><Button variant="primary" size="md" onClick={onClose}>Selesai</Button></div>
        </div>
      ) : (
        <form className="mt-stack" onSubmit={submit} noValidate>
          <fieldset className="mt-reasons">
            <legend className="mt-label" style={{ marginBottom: '0.4rem' }}>Alasan laporan</legend>
            {REASONS.map((r) => (
              <label key={r.id}>
                <input type="radio" name="report-reason" value={r.id} checked={reason === r.id} onChange={() => { setReason(r.id); setError(null); }} />
                <span>{r.label}{r.hint && <span className="mt-help"> ({r.hint})</span>}</span>
              </label>
            ))}
          </fieldset>
          <div className="mt-field">
            <label htmlFor="report-detail">Keterangan (opsional)</label>
            <textarea id="report-detail" className="mt-textarea" value={detail} maxLength={MAX} onChange={(e) => setDetail(e.target.value)} />
            <span className="mt-counter">{detail.length}/{MAX}</span>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="mt-row" style={{ justifyContent: 'flex-end' }}>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={report.isPending}>Batal</Button>
            <Button type="submit" variant="primary" size="sm" isLoading={report.isPending}>Kirim laporan</Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
