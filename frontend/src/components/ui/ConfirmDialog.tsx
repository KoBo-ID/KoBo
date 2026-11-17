import React from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

/** In-app replacement for window.confirm: focus-trapped, keyboard friendly, and styled like the rest of the app. */
export const ConfirmDialog: React.FC<{
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, message, confirmLabel, danger = false, busy = false, onConfirm, onCancel }) => (
  <Modal isOpen onClose={onCancel} title={title} maxWidth="sm">
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Batal</Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onConfirm}
          isLoading={busy}
          disabled={busy}
          style={danger ? { backgroundColor: 'var(--status-overdue-text)', borderColor: 'var(--status-overdue-text)' } : undefined}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  </Modal>
);
