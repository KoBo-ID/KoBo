import React, { useEffect, useRef, useState } from 'react';

export interface KosSection {
  id: string;
  label: string;
}

/**
 * Sticky in-page navigation for Kelola properti: plain anchors (keyboard and middle-click work), the URL hash follows the
 * section in view, and an IntersectionObserver marks the current one with aria-current. No library.
 */
export const KosSectionNav: React.FC<{ sections: KosSection[] }> = ({ sections }) => {
  const [active, setActive] = useState(() => {
    const hash = window.location.hash.slice(1);
    return sections.some((s) => s.id === hash) ? hash : (sections[0]?.id ?? '');
  });

  // A click wins over the spy while the browser is still scrolling to the target (the last sections cannot reach the band).
  const lockedUntil = useRef(0);
  const evaluate = useRef<() => void>(() => {});

  // Scroll-spy: the last section touching the band below the sticky bars is the current one.
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    if (els.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    evaluate.current = () => {
      if (Date.now() < lockedUntil.current) return;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const current = atBottom ? sections.at(-1) : [...sections].reverse().find((s) => visible.has(s.id));
      if (current) setActive(current.id);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id));
        evaluate.current();
      },
      { rootMargin: '-160px 0px -55% 0px' },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  // Keep the address in step without adding history entries.
  useEffect(() => {
    if (active && window.location.hash.slice(1) !== active && sections[0]?.id !== active) {
      window.history.replaceState(window.history.state, '', `#${active}`);
    }
  }, [active, sections]);

  return (
    <nav className="kos-sections" aria-label="Bagian halaman">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={active === s.id ? 'true' : undefined}
          onClick={() => {
            lockedUntil.current = Date.now() + 900;
            window.setTimeout(() => evaluate.current(), 950);
            setActive(s.id);
          }}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
};
