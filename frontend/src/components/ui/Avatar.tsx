import React from 'react';

interface AvatarProps {
  src?: string | null;
  name: string;
  size: number;
  style?: React.CSSProperties;
}

/** Photo when there is one, otherwise the first letter of the name on the brand tint. */
export const Avatar: React.FC<AvatarProps> = ({ src, name, size, style }) => {
  const base: React.CSSProperties = { width: `${size}px`, height: `${size}px`, borderRadius: '50%', flexShrink: 0, ...style };
  if (src) return <img src={src} alt={name} style={{ ...base, objectFit: 'cover' }} />;
  return (
    <div
      role="img"
      aria-label={name}
      style={{
        ...base,
        backgroundColor: 'var(--primary-light)',
        color: 'var(--primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: `${Math.round(size * 0.42)}px`,
      }}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
};
