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
      className="kobo-back"
      aria-label={label}
      style={style}
    >
      <ArrowLeft size={15} />
      <span>{label}</span>
    </button>
  );
};
