import React, { useId, useRef, useState } from 'react';
import type { ApplicationDecisionReason } from '@kobo/shared/types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Notice } from '../ui/Notice';
import { DECISION_NOTE_MAX, DECISION_REASON_OPTIONS } from '../../lib/decisionReason';

/** Owner reject dialog (SIM-006): a required reason plus an optional note, both sent to the applicant. Stays open until the server accepts. */
export const RejectApplicationDialog: React.FC<{
  summary: React.ReactNode;
  busy: boolean;
  /** Server refusal (e.g. contact info in the note), shown inside the dialog. */
  error: string | null;
  onSubmit: (input: { reason: ApplicationDecisionReason; note: string | undefined }) => void;
  onCancel: () => void;
}> = ({ summary, busy, error, onSubmit, onCancel }) => {
  const uid = useId();
  const reasonErrorId = `${uid}-reason-error`;
  const noteHintId = `${uid}-note-hint`;
  const noteCountId = `${uid}-note-count`;
  const firstRadio = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState<ApplicationDecisionReason | null>(null);
  const [note, setNote] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [focused, setFocused] = useState<ApplicationDecisionReason | null>(null);

  const tooLong = note.length > DECISION_NOTE_MAX;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!reason) {
      setReasonError(true);
      firstRadio.current?.focus();
      return;
    }
    if (tooLong) return;
    onSubmit({ reason, note: note.trim() || undefined });
  };

  return (
    <Modal isOpen onClose={busy ? () => {} : onCancel} title="Tolak pengajuan?" maxWidth="sm">
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', lineHeight: 1.55 }}>{summary}</div>

        <fieldset style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }} aria-describedby={reasonError ? reasonErrorId : undefined}>
          <legend style={{ fontSize: 'var(--step--1)', fontWeight: 600, color: 'var(--text-main)', padding: 0, marginBottom: '0.35rem' }}>
            Alasan penolakan (dikirim ke pengaju)
          </legend>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {DECISION_REASON_OPTIONS.map((option, i) => (
              <label
                key={option.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  minHeight: '40px',
                  padding: '0 0.6rem',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 'var(--step--1)',
                  color: 'var(--text-main)',
                  outline: focused === option.value ? '2px solid var(--primary)' : '2px solid transparent',
                  outlineOffset: '-2px',
                  backgroundColor: reason === option.value ? 'var(--primary-light)' : 'transparent',
                }}
              >
                <input
                  ref={i === 0 ? firstRadio : undefined}
                  type="radio"
                  name={`${uid}-reason`}
                  value={option.value}
                  checked={reason === option.value}
                  disabled={busy}
                  aria-invalid={reasonError || undefined}
                  aria-describedby={reasonError ? reasonErrorId : undefined}
                  onChange={() => {
                    setReason(option.value);
                    setReasonError(false);
                  }}
                  onFocus={() => setFocused(option.value)}
                  onBlur={() => setFocused((f) => (f === option.value ? null : f))}
                  style={{ width: '1.1rem', height: '1.1rem', margin: 0, accentColor: 'var(--primary)' }}
                />
                {option.ownerLabel}
              </label>
            ))}
          </div>
          {reasonError && (
            <p id={reasonErrorId} role="alert" style={{ margin: '0.35rem 0 0', fontSize: 'var(--step--1)', color: 'var(--status-overdue-text)', fontWeight: 500 }}>
              Pilih alasan penolakan.
            </p>
          )}
        </fieldset>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label htmlFor={`${uid}-note`} style={{ fontSize: 'var(--step--1)', fontWeight: 600, color: 'var(--text-main)' }}>
            Catatan untuk pengaju (opsional)
          </label>
          <textarea
            id={`${uid}-note`}
            value={note}
            rows={2}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={tooLong || undefined}
            aria-describedby={`${noteHintId} ${noteCountId}`}
            style={{
              width: '100%',
              resize: 'vertical',
              padding: '0.6rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${tooLong ? 'var(--status-overdue-text)' : 'var(--border)'}`,
              font: 'inherit',
              fontSize: 'var(--step--1)',
              color: 'var(--text-main)',
              backgroundColor: 'var(--surface, #fff)',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: 'var(--step--2, 0.8rem)', color: 'var(--text-muted)' }}>
            <span id={noteHintId}>Tanpa nomor telepon, email, atau tautan WhatsApp.</span>
            <span id={noteCountId} style={{ whiteSpace: 'nowrap', color: tooLong ? 'var(--status-overdue-text)' : undefined, fontWeight: tooLong ? 600 : undefined }}>
              {note.length}/{DECISION_NOTE_MAX}
            </span>
          </div>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>Batal</Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            isLoading={busy}
            disabled={busy || tooLong}
            style={{ backgroundColor: 'var(--status-overdue-text)', borderColor: 'var(--status-overdue-text)' }}
          >
            Tolak Pengajuan
          </Button>
        </div>
      </form>
    </Modal>
  );
};
