import React from 'react';

interface OwnerPageHeaderProps {
  title: string;
  /** One short line under the title, e.g. the active kos name. */
  subtitle?: React.ReactNode;
  /** Page-level actions, primary last (right-most). */
  actions?: React.ReactNode;
}

/** The single h1 + action row every owner page opens with. */
export const OwnerPageHeader: React.FC<OwnerPageHeaderProps> = ({ title, subtitle, actions }) => (
  <header className="owner-page-header">
    <div className="owner-page-header__text">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {actions && <div className="owner-page-header__actions">{actions}</div>}
  </header>
);
