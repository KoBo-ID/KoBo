import React from 'react';
import '../../styles/matching.css';

/**
 * Centered empty / gate panel for the matching pages.
 * `icon` is decorative (aria-hidden), `title` is an h2, `children` is the explanation, `actions` are buttons or links.
 */
export const MatchEmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ icon, title, children, actions }) => (
  <div className="mt-empty">
    {icon && <span aria-hidden="true" style={{ color: 'var(--text-subtle)', display: 'flex' }}>{icon}</span>}
    <h2>{title}</h2>
    {children && <p>{children}</p>}
    {actions && <div className="mt-empty__actions">{actions}</div>}
  </div>
);
