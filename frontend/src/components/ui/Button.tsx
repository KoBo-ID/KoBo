import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  className = '',
  disabled,
  style,
  ...props
}) => {
  // Styles mapped to tokens
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    fontWeight: 600,
    fontFamily: 'var(--font-sans)',
    borderRadius: 'var(--radius-md)',
    transition: 'all var(--duration-fast) var(--ease-out-spring)',
    cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    border: '1px solid transparent',
    textDecoration: 'none',
    width: fullWidth ? '100%' : 'auto',
    position: 'relative',
    userSelect: 'none',
  };

  // Size styling
  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: {
      padding: '0.4rem 0.8rem',
      fontSize: '0.8125rem',
      borderRadius: 'var(--radius-sm)',
    },
    md: {
      padding: '0.625rem 1.25rem',
      fontSize: '0.9375rem',
      borderRadius: 'var(--radius-btn)',
    },
    lg: {
      padding: '0.875rem 1.75rem',
      fontSize: '1rem',
      borderRadius: 'var(--radius-btn)',
    },
  };

  // Variant styling
  const variantStyles: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: 'var(--primary)',
      color: 'var(--text-inverse)',
      boxShadow: 'var(--shadow-sm)',
    },
    accent: {
      backgroundColor: 'var(--accent)',
      color: 'var(--text-inverse)',
      boxShadow: 'var(--shadow-sm)',
    },
    secondary: {
      backgroundColor: 'var(--primary-light)',
      color: 'var(--primary)',
    },
    outline: {
      backgroundColor: 'transparent',
      borderColor: 'var(--border-strong)',
      color: 'var(--text-main)',
    },
    ghost: {
      backgroundColor: 'transparent',
      color: 'var(--text-main)',
    },
    danger: {
      backgroundColor: 'var(--status-overdue-bg)',
      color: 'var(--status-overdue)',
      borderColor: 'var(--status-overdue-border)',
    },
    success: {
      backgroundColor: 'var(--status-paid-bg)',
      color: 'var(--status-paid)',
      borderColor: 'var(--status-paid-border)',
    },
  };

  return (
    <button
      className={`interactive-tap ${className}`}
      disabled={disabled || isLoading}
      style={{
        ...baseStyle,
        ...sizeStyles[size],
        ...variantStyles[variant],
        ...style,
      }}
      {...props}
    >
      {isLoading ? (
        <Loader2 size={size === 'sm' ? 14 : 18} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
      ) : (
        icon && iconPosition === 'left' && <span>{icon}</span>
      )}
      <span>{children}</span>
      {!isLoading && icon && iconPosition === 'right' && <span>{icon}</span>}
    </button>
  );
};
