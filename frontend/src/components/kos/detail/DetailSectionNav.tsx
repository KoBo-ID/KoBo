import React, { useEffect, useState } from 'react';

export interface DetailNavItem {
  id: string;
  label: string;
}

/** Desktop-only in-page navigation (CSS hides it below the two-column breakpoint). The active link follows scroll. */
export const DetailSectionNav: React.FC<{ items: DetailNavItem[] }> = ({ items }) => {
  const [active, setActive] = useState(items[0]?.id ?? '');
  const key = items.map((item) => item.id).join(',');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const targets = key.split(',').map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    // A section counts as current while it crosses the band 20%..35% from the top of the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        const current = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (current) setActive(current.target.id);
      },
      { rootMargin: '-20% 0px -65% 0px' },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  const go = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <nav className="detail-nav" aria-label="Bagian halaman">
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} onClick={(event) => go(event, item.id)} aria-current={active === item.id ? 'true' : undefined}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};
