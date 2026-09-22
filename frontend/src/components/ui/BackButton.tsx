import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface BackButtonProps {
  label?: string;
  style?: React.CSSProperties;
}

export const BackButton: React.FC<BackButtonProps> = ({ label = 'Kembali', style }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBack = location.key !== 'default';

  return (
    <button
      type="button"
      onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}
      className="interactive-tap"
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.4rem 0.8rem 0.4rem 0.6rem',
        borderRadius: 'var(--radius-btn)',
        border: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-main)',
        fontSize: '0.82rem',
        fontWeight: 600,
        boxShadow: 'var(--shadow-xs)',
        ...style,
      }}
    >
      <ArrowLeft size={15} />
      <span>{label}</span>
    </button>
  );
};
