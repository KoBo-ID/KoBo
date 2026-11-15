import React from 'react';
import { Link } from 'react-router-dom';
import { Building2, Home, LayoutDashboard, LogIn, Scissors, Search, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import '../../styles/footer.css';

type TabLink = { to: string; label: string; Icon: LucideIcon };

const SEEKER: TabLink[] = [
  { to: '/search', label: 'Cari Kos', Icon: Search },
  { to: '/my-kos', label: 'Kos Saya', Icon: Home },
  { to: '/profile', label: 'Profil', Icon: UserRound },
];
const OWNER: TabLink[] = [
  { to: '/owner/login', label: 'Portal Pemilik', Icon: LogIn },
  { to: '/owner/dashboard', label: 'Dasbor', Icon: LayoutDashboard },
  { to: '/owner/kos', label: 'Kelola Kos', Icon: Building2 },
];
const HELP: { to: string; label: string }[] = [
  { to: '/kontak', label: 'Hubungi kami' },
  { to: '/syarat', label: 'Syarat dan ketentuan' },
  { to: '/privasi', label: 'Kebijakan privasi' },
];

const Flyer: React.FC<{ cls: string; title: string; label: string; links: TabLink[] }> = ({
  cls, title, label, links,
}) => (
  <div className={`kf-card kf-flyer ${cls}`}>
    <span className="kf-pin" aria-hidden="true" />
    <div className="kf-flyer-body">
      <h2 className="kf-flyer-title">{title}</h2>
    </div>
    <div className="kf-cut" aria-hidden="true">
      <Scissors size={14} strokeWidth={2.25} />
    </div>
    <nav aria-label={label} className="kf-tabnav">
      <ul className="kf-tabs">
        {links.map(({ to, label: text, Icon }) => (
          <li key={to}>
            <Link to={to} className="kf-tab">
              <Icon size={19} strokeWidth={2} aria-hidden="true" />
              <span className="kf-tab-text">{text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  </div>
);

export const Footer: React.FC = () => (
  <footer className="kf-stack">
    <div className="kf-footer">
      <div className="app-container kf-grid">
        <div className="kf-card kf-main">
          <span className="kf-pin" aria-hidden="true" />
          <p className="kf-brand">
            Ko<span>Bo</span>
          </p>
          <p className="kf-headline">
            Survey dulu,
            <br />
            Baru sewa.
          </p>
        </div>
        <Flyer cls="kf-b" title="Cari kos?" label="Untuk pencari kos" links={SEEKER} />
        <Flyer cls="kf-c" title="Punya kos?" label="Untuk pemilik kos" links={OWNER} />
      </div>
      <div className="app-container kf-rail">
        <div className="kf-strip">
          <span className="kf-strip__copy">© 2026 KoBo</span>
          <nav aria-label="Informasi KoBo" className="kf-legal">
            {HELP.map((item) => (
              <Link key={item.to} to={item.to}>{item.label}</Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  </footer>
);
