import React from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export interface ButtonStyleProps {
  variant?: 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {
  isLoading?: boolean;
}

const SIZE_STYLES: Record<NonNullable<ButtonStyleProps['size']>, React.CSSProperties> = {
  sm: {
    padding: '0.4rem 0.8rem',
    fontSize: 'var(--step--1)',
    borderRadius: 'var(--radius-sm)',
  },
  md: {
    padding: '0.625rem 1.25rem',
    fontSize: 'var(--step-0)',
    borderRadius: 'var(--radius-btn)',
  },
  lg: {
    padding: '0.875rem 1.75rem',
    fontSize: 'var(--step-0)',
    borderRadius: 'var(--radius-btn)',
  },
};

const VARIANT_STYLES: Record<NonNullable<ButtonStyleProps['variant']>, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--primary)',
    color: 'var(--text-inverse)',
    boxShadow: 'var(--shadow-sm)',
  },
  accent: {
    backgroundColor: 'var(--accent-strong)',
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
    color: 'var(--status-overdue-text)',
    borderColor: 'var(--status-overdue-border)',
  },
  success: {
    backgroundColor: 'var(--status-paid-bg)',
    color: 'var(--status-paid-text)',
    borderColor: 'var(--status-paid-border)',
  },
};

function buttonStyle({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  style,
}: {
  variant?: ButtonStyleProps['variant'];
  size?: ButtonStyleProps['size'];
  fullWidth?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    fontWeight: 600,
    fontFamily: 'var(--font-sans)',
    borderRadius: 'var(--radius-md)',
    transition:
      'background-color 160ms ease-out, border-color 160ms ease-out, color 160ms ease-out, box-shadow 160ms ease-out, transform 160ms ease-out',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    border: '1px solid transparent',
    textDecoration: 'none',
    width: fullWidth ? '100%' : 'auto',
    position: 'relative',
    userSelect: 'none',
    ...SIZE_STYLES[size],
    ...VARIANT_STYLES[variant],
    ...style,
  };
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
}) => (
  <button
    className={`interactive-tap kobo-btn ${className}`.trim()}
    disabled={disabled || isLoading}
    style={buttonStyle({ variant, size, fullWidth, disabled: disabled || isLoading, style })}
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

export interface ButtonLinkProps extends Omit<LinkProps, 'className' | 'style'>, ButtonStyleProps {
  className?: string;
  style?: React.CSSProperties;
}

/** Visually identical to Button, rendered as a semantic react-router Link (no nested interactive elements). */
export const ButtonLink: React.FC<ButtonLinkProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  fullWidth = false,
  className = '',
  style,
  ...props
}) => (
  <Link
    className={`interactive-tap kobo-btn ${className}`.trim()}
    style={buttonStyle({ variant, size, fullWidth, style })}
    {...props}
  >
    {icon && iconPosition === 'left' && <span>{icon}</span>}
    <span>{children}</span>
    {icon && iconPosition === 'right' && <span>{icon}</span>}
  </Link>
);

export interface ButtonAnchorProps extends React.AnchorHTMLAttributes<HTMLAnchorElement>, ButtonStyleProps {}

/** Visually identical to Button, rendered as a semantic external anchor `<a>`. */
export const ButtonAnchor: React.FC<ButtonAnchorProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  fullWidth = false,
  className = '',
  style,
  ...props
}) => (
  <a
    className={`interactive-tap kobo-btn ${className}`.trim()}
    style={buttonStyle({ variant, size, fullWidth, style })}
    {...props}
  >
    {icon && iconPosition === 'left' && <span>{icon}</span>}
    <span>{children}</span>
    {icon && iconPosition === 'right' && <span>{icon}</span>}
  </a>
);
