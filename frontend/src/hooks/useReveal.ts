import { useLayoutEffect, useRef } from 'react';

interface RevealOptions {
  /** 'top' (default) plays once the element's top nears the viewport; 'bottom' waits until its bottom edge is on screen. */
  at?: 'top' | 'bottom';
}

/** Arms an element hidden, then plays its reveal once as it nears the viewport. Never arms under reduced motion. */
export function useReveal<T extends HTMLElement>({ at = 'top' }: RevealOptions = {}) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().bottom < 0) return; // already scrolled past: stay visible, no replay
    el.dataset.reveal = 'armed';

    // 'bottom': wait for the whole element to be in view. An element taller than the viewport can never be fully
    // visible, so cap the ratio at the share of it the viewport can hold.
    const bottomMargin = at === 'bottom' ? 0.05 : 0.15;
    const threshold = at === 'bottom'
      ? Math.max(0.01, Math.min(0.99, (window.innerHeight * (1 - bottomMargin)) / Math.max(1, el.offsetHeight) - 0.01))
      : 0;

    const io = new IntersectionObserver(([e]) => {
      const reached = at === 'bottom' ? e.intersectionRatio >= threshold : e.isIntersecting;
      if (!reached && e.boundingClientRect.top >= 0) return;
      el.dataset.reveal = 'in'; // also fires when restored scroll leaves it above the fold
      io.disconnect();
    }, { rootMargin: `0px 0px -${bottomMargin * 100}% 0px`, threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [at]);
  return ref;
}
