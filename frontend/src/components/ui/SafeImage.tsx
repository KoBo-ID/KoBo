import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';

type SafeImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  /** Extra style for the placeholder only (e.g. a size when the img itself is sized by max-width/height). */
  placeholderStyle?: React.CSSProperties;
  iconSize?: number;
};

/**
 * `srcSet` for photos whose URL carries a `w=` width (the seeded Unsplash photos), so a small slot fetches a small file.
 * Other URLs (uploaded photos, other hosts) get no srcSet and keep loading their one file.
 */
export const widthSrcSet = (src: string | undefined, widths: number[]): { srcSet?: string } => {
  if (!src || !/[?&]w=\d+/.test(src)) return {};
  return { srcSet: widths.map((w) => `${src.replace(/([?&])w=\d+/, `$1w=${w}`)} ${w}w`).join(', ') };
};

/**
 * A plain <img> that swaps itself for a neutral surface block with an ImageOff icon when the
 * remote photo fails to load, instead of the browser's broken-image glyph. Layout props
 * (style, className, mouse handlers) carry over to the placeholder so the box keeps its size.
 */
export const SafeImage: React.FC<SafeImageProps> = ({ placeholderStyle, iconSize = 24, onError, ...img }) => {
  // Remember which src failed, so a carousel moving to another src retries automatically.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = typeof img.src === 'string' ? img.src : '';

  if (!src || failedSrc === src) {
    const { style, className, onClick, onMouseEnter, onMouseLeave, alt } = img;
    return (
      <div
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={className}
        onClick={onClick as React.MouseEventHandler<HTMLDivElement> | undefined}
        onMouseEnter={onMouseEnter as React.MouseEventHandler<HTMLDivElement> | undefined}
        onMouseLeave={onMouseLeave as React.MouseEventHandler<HTMLDivElement> | undefined}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--bg-muted)',
          color: 'var(--text-muted)',
          ...placeholderStyle,
        }}
      >
        <ImageOff size={iconSize} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      decoding="async"
      {...img}
      onError={(e) => {
        setFailedSrc(src);
        onError?.(e);
      }}
    />
  );
};
