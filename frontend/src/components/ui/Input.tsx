import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  iconLeft,
  iconRight,
  fullWidth = true,
  className = '',
  id,
  style,
  ...props
}) => {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div style={{ width: fullWidth ? '100%' : 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--text-main)',
          }}
        >
          {label}
        </label>
      )}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
        }}
      >
        {iconLeft && (
          <span
            style={{
              position: 'absolute',
              left: '0.85rem',
              color: 'var(--text-subtle)',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
            }}
          >
            {iconLeft}
          </span>
        )}
        <input
          id={inputId}
          className={className}
          style={{
            width: '100%',
            padding: '0.625rem 0.875rem',
            paddingLeft: iconLeft ? '2.5rem' : '0.875rem',
            paddingRight: iconRight ? '2.5rem' : '0.875rem',
            fontSize: '0.9375rem',
            fontFamily: 'var(--font-sans)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-main)',
            border: `1.5px solid ${error ? 'var(--status-overdue)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--radius-md)',
            transition: 'border-color var(--duration-fast) var(--ease-out-spring), box-shadow var(--duration-fast) var(--ease-out-spring)',
            ...style,
          }}
          {...props}
        />
        {iconRight && (
          <span
            style={{
              position: 'absolute',
              right: '0.85rem',
              color: 'var(--text-subtle)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {iconRight}
          </span>
        )}
      </div>
      {error && (
        <span style={{ fontSize: '0.8rem', color: 'var(--status-overdue)', fontWeight: 500 }}>
          {error}
        </span>
      )}
      {!error && helperText && (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {helperText}
        </span>
      )}
    </div>
  );
};
