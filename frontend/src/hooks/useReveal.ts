import { useLayoutEffect, useRef } from 'react';

/** Arms an element hidden, then plays its reveal once as it nears the viewport. Never arms under reduced motion. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().bottom < 0) return; // already scrolled past: stay visible, no replay
    el.dataset.reveal = 'armed';
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting && e.boundingClientRect.top >= 0) return;
      el.dataset.reveal = 'in'; // also fires when restored scroll leaves it above the fold
      io.disconnect();
    }, { rootMargin: '0px 0px -15% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
