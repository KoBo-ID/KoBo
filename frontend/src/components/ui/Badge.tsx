import React from 'react';
import { KosGender, RoomStatus } from '../../types';

export type BadgeVariant =
  | 'campur'
  | 'putra'
  | 'putri'
  | 'discount'
  | 'paid'
  | 'due'
  | 'overdue'
  | 'vacant'
  | 'booking'
  | 'subtle'
  | 'primary';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
  style?: React.CSSProperties;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'subtle',
  children,
  icon,
  size = 'md',
  className = '',
  style,
}) => {
  const getBadgeStyle = (): React.CSSProperties => {
    switch (variant) {
      case 'campur':
        return {
          backgroundColor: 'var(--badge-campur-bg)',
          color: 'var(--badge-campur-text)',
          border: '1px solid var(--badge-campur-border)',
        };
      case 'putra':
        return {
          backgroundColor: 'var(--badge-putra-bg)',
          color: 'var(--badge-putra-text)',
          border: '1px solid var(--badge-putra-border)',
        };
      case 'putri':
        return {
          backgroundColor: 'var(--badge-putri-bg)',
          color: 'var(--badge-putri-text)',
          border: '1px solid var(--badge-putri-border)',
        };
      case 'discount':
        return {
          backgroundColor: 'var(--accent-light)',
          color: 'var(--accent)',
          border: '1px solid hsla(24, 95%, 53%, 0.25)',
        };
      case 'paid':
        return {
          backgroundColor: 'var(--status-paid-bg)',
          color: 'var(--status-paid)',
          border: '1px solid var(--status-paid-border)',
        };
      case 'due':
        return {
          backgroundColor: 'var(--status-due-bg)',
          color: 'var(--status-due)',
          border: '1px solid var(--status-due-border)',
        };
      case 'overdue':
        return {
          backgroundColor: 'var(--status-overdue-bg)',
          color: 'var(--status-overdue)',
          border: '1px solid var(--status-overdue-border)',
        };
      case 'vacant':
        return {
          backgroundColor: 'var(--status-vacant-bg)',
          color: 'var(--status-vacant)',
          border: '1px solid var(--status-vacant-border)',
        };
      case 'booking':
        return {
          backgroundColor: 'var(--status-booking-bg)',
          color: 'var(--status-booking)',
          border: '1px solid var(--status-booking-border)',
        };
      case 'primary':
        return {
          backgroundColor: 'var(--primary-light)',
          color: 'var(--primary)',
          border: '1px solid hsla(158, 64%, 32%, 0.2)',
        };
      default:
        return {
          backgroundColor: 'var(--bg-muted)',
          color: 'var(--text-muted)',
          border: '1px solid var(--border-subtle)',
        };
    }
  };

  const isSmall = size === 'sm';

  return (
    <span
      className={`pill-badge ${className}`}
      style={{
        ...getBadgeStyle(),
        fontSize: isSmall ? '0.7rem' : '0.75rem',
        padding: isSmall ? '0.15rem 0.5rem' : '0.25rem 0.55rem',
        borderRadius: 'var(--radius-badge)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        fontWeight: 600,
        letterSpacing: '0.01em',
        ...style,
      }}
    >
      {icon && <span>{icon}</span>}
      <span>{children}</span>
    </span>
  );
};

export const GenderBadge: React.FC<{ gender: KosGender; size?: 'sm' | 'md' }> = ({ gender, size }) => {
  const labelMap = {
    campur: 'Campur',
    putra: 'Putra',
    putri: 'Putri',
  };

  return (
    <Badge variant={gender} size={size}>
      {labelMap[gender]}
    </Badge>
  );
};

export const RoomStatusBadge: React.FC<{ status: RoomStatus; size?: 'sm' | 'md' }> = ({ status, size }) => {
  const labelMap: Record<RoomStatus, string> = {
    paid: 'Lunas',
    due: 'Jatuh Tempo',
    overdue: 'Menunggak',
    vacant: 'Kosong',
    booking: 'Booking',
  };

  return (
    <Badge variant={status} size={size}>
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: 'currentColor',
          display: 'inline-block',
        }}
      />
      {labelMap[status]}
    </Badge>
  );
};
