import React from 'react';

/** Inline form feedback. Errors use role="alert", confirmations role="status". Colours are the status tokens. */
export const Notice: React.FC<{ tone: 'error' | 'success'; children: React.ReactNode }> = ({ tone, children }) => {
  const error = tone === 'error';
  return (
    <div
      role={error ? 'alert' : 'status'}
      style={{
        padding: '0.7rem 0.9rem',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: error ? 'var(--status-overdue-bg)' : 'var(--primary-light)',
        border: `1px solid ${error ? 'var(--status-overdue-border)' : 'var(--primary)'}`,
        color: error ? 'var(--status-overdue)' : 'var(--primary)',
        fontSize: '0.85rem',
        fontWeight: 500,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
};
