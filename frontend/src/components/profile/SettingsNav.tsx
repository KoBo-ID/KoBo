import React from 'react';
import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export interface SettingsNavItem { slug: string; label: string; Icon: LucideIcon }
export interface SettingsNavGroup { title: string; items: SettingsNavItem[] }

/** Sidebar on wide screens, a scrolling tab strip on phones. NavLink sets aria-current="page" on the active section. */
export const SettingsNav: React.FC<{ groups: SettingsNavGroup[]; base: string }> = ({ groups, base }) => (
  <nav className="ps__nav" aria-label="Pengaturan akun">
    <div className="ps__groups">
      {groups.map((g) => (
        <section key={g.title} className="ps__group" aria-label={g.title}>
          <h2 className="ps__group-title">{g.title}</h2>
          <ul>
            {g.items.map(({ slug, label, Icon }) => (
              <li key={slug} style={{ display: 'contents' }}>
                <NavLink to={slug ? `${base}/${slug}` : base} end className="ps__link" data-testid={`settings-nav-${slug || 'profil'}`}>
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  </nav>
);
