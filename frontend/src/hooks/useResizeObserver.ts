import { useState, useEffect, RefObject } from 'react';

interface DOMRectReadOnlyLike {
  width: number;
  height: number;
}

/**
 * Hook to measure an element's dimensions in real-time via ResizeObserver.
 */
export const useResizeObserver = <T extends HTMLElement>(
  ref: RefObject<T | null>
): DOMRectReadOnlyLike => {
  const [dimensions, setDimensions] = useState<DOMRectReadOnlyLike>({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Set initial dimensions
    setDimensions({
      width: element.offsetWidth,
      height: element.offsetHeight,
    });

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      if (!entries || !entries[0]) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return dimensions;
};
