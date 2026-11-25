import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatRupiah } from '../../lib/format';
import { formatLongDateWIB } from '../../lib/dates';

/** The unpaid, past-due months of a tenancy, in the overdue tint. Icon plus text, never colour alone. */
export const ArrearsSummary: React.FC<{
  total: number;
  arrears: { invoiceId: string; dueDate: string; amount: number }[];
}> = ({ total, arrears }) => (
  <div
    style={{
      display: 'flex',
      gap: '0.65rem',
      alignItems: 'flex-start',
      padding: '0.7rem 0.9rem',
      borderRadius: 'var(--radius-sm)',
      backgroundColor: 'var(--status-overdue-bg)',
      border: '1px solid var(--status-overdue-border)',
      color: 'var(--status-overdue-text)',
      fontSize: 'var(--step--1)',
      lineHeight: 1.5,
    }}
  >
    <AlertTriangle size={18} aria-hidden="true" style={{ flex: 'none', marginTop: '0.1rem' }} />
    <div style={{ minWidth: 0 }}>
      <p style={{ margin: 0, fontWeight: 700 }}>Masih ada tunggakan {formatRupiah(total)}</p>
      <ul style={{ margin: '0.25rem 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        {arrears.map((a) => (
          <li key={a.invoiceId} style={{ fontVariantNumeric: 'tabular-nums' }}>
            Tagihan jatuh tempo {formatLongDateWIB(a.dueDate)} · {formatRupiah(a.amount)}
          </li>
        ))}
      </ul>
    </div>
  </div>
);
