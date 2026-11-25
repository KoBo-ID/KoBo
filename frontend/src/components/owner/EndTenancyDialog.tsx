import React, { useId, useRef, useState } from 'react';
import type { TenancyEndPreview } from '../../../../backend/src/trpc/router';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Notice } from '../ui/Notice';
import { ArrearsSummary } from './ArrearsSummary';

export type ArrearsChoice = { arrears: 'KEEP' | 'WAIVE'; waiverReason?: string };

const MAX_REASON = 200;
const MIN_REASON = 5;

const optionStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.6rem',
  alignItems: 'flex-start',
  minHeight: '2.5rem',
  padding: '0.45rem 0',
  cursor: 'pointer',
};

/**
 * Ending a lease that still has past-due months: the owner decides whether the debt stays on the board ("Tunggakan penyewa lama")
 * or is waived with a recorded reason. KEEP is preselected; the destructive option is never the default.
 */
export const EndTenancyDialog: React.FC<{
  roomNumber: string;
  tenantName?: string | null;
  preview: TenancyEndPreview;
  busy: boolean;
  /** An error or conflict message shown inside the dialog. */
  notice: string | null;
  onCancel: () => void;
  onConfirm: (choice: ArrearsChoice) => void;
}> = ({ roomNumber, tenantName, preview, busy, notice, onCancel, onConfirm }) => {
  const [choice, setChoice] = useState<'KEEP' | 'WAIVE'>('KEEP');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const uid = useId();
  const keepHint = `${uid}-keep-hint`;
  const waiveHint = `${uid}-waive-hint`;
  const reasonId = `${uid}-reason`;
  const reasonErrId = `${uid}-reason-err`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (choice === 'WAIVE') {
      const trimmed = reason.trim();
      if (trimmed.length < MIN_REASON) {
        setReasonError(`Tulis alasan minimal ${MIN_REASON} karakter.`);
        reasonRef.current?.focus();
        return;
      }
      onConfirm({ arrears: 'WAIVE', waiverReason: trimmed });
      return;
    }
    onConfirm({ arrears: 'KEEP' });
  };

  const waive = choice === 'WAIVE';

  return (
    <Modal isOpen role="alertdialog" onClose={busy ? () => {} : onCancel} title={`Akhiri sewa Kamar ${roomNumber}`} subtitle={tenantName || undefined} maxWidth="md">
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {notice && <Notice tone="error">{notice}</Notice>}

        <ArrearsSummary total={preview.arrearsTotal} arrears={preview.arrears} />

        {preview.futureUnpaidCount > 0 && (
          <p style={{ margin: 0, fontSize: 'var(--step--1)', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Bulan yang belum jatuh tempo tidak akan ditagih.
          </p>
        )}

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
          <legend style={{ fontSize: 'var(--step--1)', fontWeight: 700, color: 'var(--text-main)', padding: 0, marginBottom: '0.3rem' }}>
            Apa yang terjadi dengan tunggakan ini?
          </legend>

          <label style={optionStyle}>
            <input
              type="radio"
              name={`${uid}-arrears`}
              value="KEEP"
              checked={!waive}
              aria-describedby={keepHint}
              onChange={() => { setChoice('KEEP'); setReasonError(null); }}
              style={{ marginTop: '0.2rem', flex: 'none' }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
              <span style={{ fontSize: 'var(--step--1)', fontWeight: 600 }}>Tetap ditagih</span>
              <span id={keepHint} style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Tercatat di papan sebagai "Tunggakan penyewa lama". Anda tetap bisa menandainya lunas saat penyewa membayar.
              </span>
            </span>
          </label>

          <label style={optionStyle}>
            <input
              type="radio"
              name={`${uid}-arrears`}
              value="WAIVE"
              checked={waive}
              aria-describedby={waiveHint}
              onChange={() => setChoice('WAIVE')}
              style={{ marginTop: '0.2rem', flex: 'none' }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
              <span style={{ fontSize: 'var(--step--1)', fontWeight: 600 }}>Hapus tunggakan</span>
              <span id={waiveHint} style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Tunggakan tidak ditagih lagi. Penghapusan tercatat dan tidak dapat dibatalkan.
              </span>
            </span>
          </label>
        </fieldset>

        {waive && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label htmlFor={reasonId} style={{ fontSize: 'var(--step--1)', fontWeight: 600 }}>Alasan penghapusan</label>
            <textarea
              id={reasonId}
              ref={reasonRef}
              rows={3}
              value={reason}
              maxLength={MAX_REASON}
              aria-required="true"
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? reasonErrId : undefined}
              onChange={(e) => { setReason(e.target.value); if (reasonError) setReasonError(null); }}
              style={{
                width: '100%',
                padding: '0.625rem 0.875rem',
                fontSize: 'var(--step-0)',
                fontFamily: 'var(--font-sans)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-main)',
                border: `1.5px solid ${reasonError ? 'var(--status-overdue)' : 'var(--border-strong)'}`,
                borderRadius: 'var(--radius-md)',
                resize: 'vertical',
                minHeight: '5rem',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: 'var(--step--1)' }}>
              {reasonError ? (
                <span id={reasonErrId} style={{ color: 'var(--status-overdue-text)', fontWeight: 500 }}>
                  <span className="sr-only">Error: </span>{reasonError}
                </span>
              ) : <span />}
              <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>{reason.length}/{MAX_REASON}</span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>Batal</Button>
          <Button type="submit" variant={waive ? 'danger' : 'primary'} size="sm" isLoading={busy}>
            {waive ? 'Hapus tunggakan dan akhiri sewa' : 'Akhiri sewa'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
