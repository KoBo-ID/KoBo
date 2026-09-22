import React from 'react';

export type PillTone = 'primary' | 'accent' | 'neutral' | 'inverse';

interface PillProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  tone?: PillTone;
  size?: 'sm' | 'md';
  className?: string;
  style?: React.CSSProperties;
}

const toneStyles: Record<PillTone, React.CSSProperties> = {
  primary: {
    backgroundColor: 'var(--primary-light)',
    color: 'var(--primary)',
    borderColor: 'hsla(176, 55%, 78%, 0.9)',
  },
  accent: {
    backgroundColor: 'var(--accent-light)',
    color: 'var(--accent)',
    borderColor: 'hsla(190, 85%, 78%, 0.9)',
  },
  neutral: {
    backgroundColor: 'var(--bg-muted)',
    color: 'var(--text-muted)',
    borderColor: 'var(--border-subtle)',
  },
  inverse: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    color: 'var(--text-inverse)',
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
};

export const Pill: React.FC<PillProps> = ({
  children,
  icon,
  tone = 'primary',
  size = 'md',
  className = '',
  style,
}) => {
  const isSmall = size === 'sm';

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isSmall ? '0.3rem' : '0.4rem',
        padding: isSmall ? '0.2rem 0.55rem' : '0.32rem 0.75rem',
        borderRadius: 'var(--radius-pill)',
        border: '1px solid',
        fontSize: isSmall ? '0.72rem' : '0.78rem',
        fontWeight: 700,
        letterSpacing: '0.01em',
        lineHeight: 1.35,
        ...toneStyles[tone],
        ...style,
      }}
    >
      {icon}
      <span>{children}</span>
    </span>
  );
};
