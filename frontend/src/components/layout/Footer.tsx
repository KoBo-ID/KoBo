import React from 'react';
import { Link } from 'react-router-dom';
import { Building2, Home, LayoutDashboard, LogIn, Scissors, Search, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import '../../styles/footer.css';

type TabLink = { to: string; label: string; Icon: LucideIcon };

const SEEKER: TabLink[] = [
  { to: '/search', label: 'Cari Kos', Icon: Search },
  { to: '/my-kos', label: 'Kos Saya', Icon: Home },
  { to: '/profile', label: 'Profil & Email Kampus', Icon: UserRound },
];
const OWNER: TabLink[] = [
  { to: '/owner/login', label: 'Masuk Portal Pemilik', Icon: LogIn },
  { to: '/owner/dashboard', label: 'Dasbor', Icon: LayoutDashboard },
  { to: '/owner/kos', label: 'Kelola Kos', Icon: Building2 },
];

const Flyer: React.FC<{ cls: string; title: string; note: string; label: string; links: TabLink[] }> = ({
  cls, title, note, label, links,
}) => (
  <div className={`kf-card kf-flyer ${cls}`}>
    <span className="kf-pin" aria-hidden="true" />
    <div className="kf-flyer-body">
      <h2 className="kf-flyer-title">{title}</h2>
      <p className="kf-flyer-note">{note}</p>
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

// Notice-board footer: the band is a kos notice board; the seeker and owner
// links are the tear-off tabs of two flyers. Legal links return once those
// pages exist (see docs/superpowers/plans/2026-10-13-landing-deslop.md).
export const Footer: React.FC = () => (
  <footer className="kf-footer">
    <div className="app-container kf-grid">
      <div className="kf-card kf-main">
        <span className="kf-pin" aria-hidden="true" />
        <p className="kf-brand">
          Ko<span>Bo</span>
        </p>
        <p className="kf-headline">Survey dulu, baru sewa.</p>
        <p className="kf-sub">Cari kos dekat kampus, lihat langsung sebelum memutuskan.</p>
        <div className="kf-note">
          <span className="kf-tape" aria-hidden="true" />
          <p>© 2026 KoBo</p>
        </div>
      </div>
      <Flyer cls="kf-b" title="Cari kos?" note="Sobek satu, mulai dari sini." label="Untuk pencari kos" links={SEEKER} />
      <Flyer cls="kf-c" title="Punya kos?" note="Kelola kamar dan pengajuan dari satu papan." label="Untuk pemilik kos" links={OWNER} />
    </div>
  </footer>
);
