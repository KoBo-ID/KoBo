import React from 'react';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  error?: string;
  fullWidth?: boolean;
}

export const Select: React.FC<SelectProps> = ({
  label,
  options,
  error,
  fullWidth = true,
  className = '',
  id,
  style,
  ...props
}) => {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div style={{ width: fullWidth ? '100%' : 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {label && (
        <label
          htmlFor={selectId}
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--text-main)',
          }}
        >
          {label}
        </label>
      )}
      <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
        <select
          id={selectId}
          className={className}
          style={{
            width: '100%',
            appearance: 'none',
            padding: '0.625rem 2.25rem 0.625rem 0.875rem',
            fontSize: '0.9375rem',
            fontFamily: 'var(--font-sans)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-main)',
            border: `1.5px solid ${error ? 'var(--status-overdue)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            ...style,
          }}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span
          style={{
            position: 'absolute',
            right: '0.85rem',
            color: 'var(--text-subtle)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <ChevronDown size={18} />
        </span>
      </div>
      {error && (
        <span style={{ fontSize: '0.8rem', color: 'var(--status-overdue)', fontWeight: 500 }}>
          {error}
        </span>
      )}
    </div>
  );
};
