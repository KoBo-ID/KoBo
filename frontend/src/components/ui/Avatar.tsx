import React, { useState } from 'react';

interface AvatarProps {
  src?: string | null;
  name: string;
  size: number;
  style?: React.CSSProperties;
}

/** Photo when there is one (and it loads), otherwise the first letter of the name on the brand tint. */
export const Avatar: React.FC<AvatarProps> = ({ src, name, size, style }) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const base: React.CSSProperties = { width: `${size}px`, height: `${size}px`, borderRadius: '50%', flexShrink: 0, ...style };
  if (src && failedSrc !== src) {
    return <img src={src} alt={name} onError={() => setFailedSrc(src)} style={{ ...base, objectFit: 'cover' }} />;
  }
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
