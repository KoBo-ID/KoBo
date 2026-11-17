import React, { useEffect, useRef, useState } from 'react';
import { BuildingPoster } from './BuildingPoster';

// Gate runs BEFORE the dynamic import, so mobile / reduced-motion / no-WebGL
// visitors download ZERO bytes of three.
function shouldLoad3D(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth < 768) return false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (!('IntersectionObserver' in window)) return false;
  try {
    const c = document.createElement('canvas');
    if (!c.getContext('webgl2')) return false;
  } catch {
    return false;
  }
  return true;
}

export const HeroScene: React.FC = () => {
  const host = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [live, setLive] = useState(false);

  // Effect 1: arm once the stage is near the viewport.
  useEffect(() => {
    const el = host.current;
    if (!el || !shouldLoad3D()) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Effect 2: fetch three and run the imperative scene.
  useEffect(() => {
    const el = host.current;
    if (!armed || !el) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    import('./scene/building')
      .then((m) => {
        if (cancelled) return;
        stop = m.start(el, () => {
          if (!cancelled) setLive(true);
        });
      })
      .catch(() => {
        /* chunk failed: poster stays */
      });
    return () => {
      cancelled = true;
      stop?.();
      setLive(false);
    };
  }, [armed]);

  return (
    <div className="kobo-hero-canvas" ref={host}>
      <BuildingPoster
        className={`kobo-hero-canvas__poster${live ? ' is-hidden' : ''}`}
        decorative={live}
      />
    </div>
  );
};
