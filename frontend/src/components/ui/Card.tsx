import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverEffect?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  border?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  hoverEffect = false,
  padding = 'md',
  border = true,
  className = '',
  style,
  ...props
}) => {
  const paddingMap = {
    none: '0',
    sm: '0.875rem',
    md: '1.25rem',
    lg: '1.75rem',
  };

  return (
    <div
      className={`${hoverEffect ? 'card-hover-lift' : ''} ${className}`}
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: border ? '1px solid var(--border-subtle)' : 'none',
        boxShadow: 'var(--shadow-sm)',
        padding: paddingMap[padding],
        overflow: 'hidden',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
};
