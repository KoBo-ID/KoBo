import React, { useId } from 'react';
import { InfoTip } from './InfoTip';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  error?: string;
  helperText?: string;
  info?: React.ReactNode;
  fullWidth?: boolean;
}

export const Select: React.FC<SelectProps> = ({
  label,
  options,
  error,
  helperText,
  info,
  fullWidth = true,
  className = '',
  id,
  style,
  ...props
}) => {
  const autoId = useId();
  const selectId = id || autoId;
  const noteId = `${selectId}-note`;

  return (
    <div style={{ width: fullWidth ? '100%' : 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {label && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
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
          {info && <InfoTip label={label}>{info}</InfoTip>}
        </div>
      )}
      <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || helperText ? noteId : undefined}
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
            color: 'var(--text-muted)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <ChevronDown size={18} />
        </span>
      </div>
      {error && (
        <span id={noteId} style={{ fontSize: '0.8rem', color: 'var(--status-overdue-text)', fontWeight: 500 }}>
          <span className="sr-only">Error: </span>
          {error}
        </span>
      )}
      {!error && helperText && (
        <span id={noteId} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{helperText}</span>
      )}
    </div>
  );
};
