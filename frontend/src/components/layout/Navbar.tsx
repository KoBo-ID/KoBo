import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  User,
  LogOut,
  Calendar,
  CheckCircle2,
  Building2,
  LogIn,
} from 'lucide-react';
import { useAppStore } from '../../store/AppContext';
import { useScheduledVisitCount } from '../../lib/visits';
import { useAuthActions, useSession } from '../../lib/session';
import { useLiveTenancyCount } from '../../lib/booking';

interface NavbarProps {
  onOpenAuth?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenAuth }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { addToast } = useAppStore();
  const { me } = useSession();
  const { logout } = useAuthActions();

  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  /* On Home the bar starts transparent over the full-viewport hero and only
     turns solid once the hero has scrolled past it. Every other route keeps
     the solid bar. Only colours change between states - heights, paddings and
     border widths are identical - so no element ever moves. */
  const isHome = location.pathname === '/';
  const [overHero, setOverHero] = useState(isHome);
  useEffect(() => {
    if (!isHome) {
      setOverHero(false);
      return;
    }
    const hero = document.getElementById('kobo-hero');
    if (!hero) return;
    const headerPx =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 72;
    // Shrink the root by the bar's height: the hero counts as "under the bar"
    // until its bottom edge passes the bar's bottom edge.
    const io = new IntersectionObserver(([entry]) => setOverHero(entry.isIntersecting), {
      rootMargin: `-${headerPx}px 0px 0px 0px`,
    });
    io.observe(hero);
    return () => io.disconnect();
  }, [isHome]);
  const solid = !overHero;

  // The chips exist to lift the controls off the hero art. Once the bar itself
  // is solid they are redundant, so they fade out entirely rather than sitting
  // as grey blocks on a white bar.
  const chipFill = solid ? 'transparent' : 'rgba(255, 255, 255, 0.3)';
  const chipBorder = solid ? 'transparent' : 'rgba(255, 255, 255, 0.6)';
  const fade =
    'background-color var(--duration-normal) ease, border-color var(--duration-normal) ease, backdrop-filter var(--duration-normal) ease';

  const handleLogout = async () => {
    setProfileDropdownOpen(false);
    try {
      await logout();
      addToast('Anda telah keluar.', 'info');
      navigate('/');
    } catch {
      addToast('Gagal keluar. Silakan coba lagi.', 'error');
    }
  };

  const activeRentalsCount = useLiveTenancyCount();
  const activeVisitsCount = useScheduledVisitCount();

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 'var(--z-header)',
        backgroundColor: solid ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0)',
        backdropFilter: solid ? 'blur(12px)' : 'none',
        borderBottom: `1px solid ${solid ? 'var(--border-subtle)' : 'transparent'}`,
        transition: fade,
        height: 'var(--header-height)',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div
        className="app-container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1.5rem',
          width: '100%',
        }}
      >
        {/* Zone 1: Brand Group */}
        <Link
          to="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            textDecoration: 'none',
            flexShrink: 0,
            /* Same chip treatment as "Kos Saya". Padding and radius are applied
               in BOTH states so only the colours cross-fade and the logo never
               shifts position. */
            padding: '0.3rem 0.8rem 0.3rem 0.5rem',
            borderRadius: '12px',
            backgroundColor: chipFill,
            border: `1px solid ${chipBorder}`,
            backdropFilter: solid ? 'none' : 'blur(6px)',
            transition: fade,
          }}
        >
          {/* The favicon mark is already brand teal on transparent, so it needs
              no coloured tile behind it. */}
          <img
            src="/favicon.svg"
            alt=""
            width={34}
            height={34}
            style={{ display: 'block', flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: '1.35rem',
              fontWeight: 800,
              color: 'var(--text-main)',
              letterSpacing: '-0.025em',
              lineHeight: 1,
            }}
          >
            Ko<span style={{ color: 'var(--primary)' }}>Bo</span>
          </span>
        </Link>

        {/* Zone 2: Navigation Actions (Kos Saya + User Profile only) */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
          <Link
            to="/my-kos"
            style={{
              fontSize: '0.875rem',
              fontWeight: location.pathname === '/my-kos' ? 700 : 600,
              color: location.pathname === '/my-kos' ? 'var(--primary)' : 'var(--text-main)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 0.75rem',
              borderRadius: '10px',
              backgroundColor: chipFill,
              border: `1px solid ${chipBorder}`,
              backdropFilter: solid ? 'none' : 'blur(6px)',
              transition: fade,
              position: 'relative',
            }}
          >
            <Home size={16} />
            <span>Kos Saya</span>
            {(activeRentalsCount > 0 || activeVisitsCount > 0) && (
              <span
                style={{
                  minWidth: '18px',
                  height: '18px',
                  padding: '0 4px',
                  borderRadius: 'var(--radius-pill)',
                  backgroundColor: 'var(--accent)',
                  color: 'white',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {activeRentalsCount + activeVisitsCount}
              </span>
            )}
          </Link>

          {/* Logged out: a single sign-in chip. Logged in: avatar + menu. */}
          {!me && (
            <button
              type="button"
              onClick={() => onOpenAuth?.()}
              className="interactive-tap"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.875rem',
                fontWeight: 700,
                color: 'var(--primary)',
                padding: '0.5rem 0.9rem',
                borderRadius: '10px',
                backgroundColor: chipFill,
                border: `1px solid ${chipBorder}`,
                backdropFilter: solid ? 'none' : 'blur(6px)',
                transition: fade,
              }}
            >
              <LogIn size={16} />
              <span>Masuk</span>
            </button>
          )}

          {/* User Profile Trigger */}
          {me && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setProfileDropdownOpen((prev) => !prev)}
              className="interactive-tap"
              aria-label="Menu Pengguna"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.3rem',
                borderRadius: '50%',
                backgroundColor: chipFill,
                border: `1px solid ${chipBorder}`,
                backdropFilter: solid ? 'none' : 'blur(6px)',
                transition: fade,
              }}
            >
              {me.user.image ? (
                <img
                  src={me.user.image}
                  alt={me.user.name}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: profileDropdownOpen ? '2px solid var(--primary)' : '2px solid var(--border-subtle)',
                  }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--primary-light)',
                    color: 'var(--primary)',
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: profileDropdownOpen ? '2px solid var(--primary)' : '2px solid var(--border-subtle)',
                  }}
                >
                  {me.user.name.trim().charAt(0).toUpperCase()}
                </span>
              )}
            </button>

            {/* Dropdown Menu */}
            {profileDropdownOpen && (
              <div
                className="animate-slide-up"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 8px)',
                  width: '240px',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-xl)',
                  border: '1px solid var(--border-subtle)',
                  padding: '0.5rem 0',
                  zIndex: 'var(--z-dropdown)',
                }}
              >
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                  <p style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                    {me!.user.name}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {me!.user.email}
                  </p>
                  {me!.campusVerified && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        color: 'var(--primary)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        marginTop: '0.4rem',
                      }}
                    >
                      <CheckCircle2 size={13} />
                      <span>Mahasiswa Terverifikasi</span>
                    </div>
                  )}
                </div>

                {me!.isOwner && (
                  <Link
                    to="/owner/dashboard"
                    onClick={() => setProfileDropdownOpen(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.65rem',
                      padding: '0.65rem 1rem',
                      fontSize: '0.875rem',
                      color: 'var(--text-main)',
                    }}
                    className="interactive-tap"
                  >
                    <Building2 size={16} color="var(--text-muted)" />
                    <span>Ruang Kerja Pemilik</span>
                  </Link>
                )}

                <Link
                  to="/profile"
                  onClick={() => setProfileDropdownOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    padding: '0.65rem 1rem',
                    fontSize: '0.875rem',
                    color: 'var(--text-main)',
                  }}
                  className="interactive-tap"
                >
                  <User size={16} color="var(--text-muted)" />
                  <span>Profil &amp; Email Kampus</span>
                </Link>

                <Link
                  to="/my-kos"
                  onClick={() => setProfileDropdownOpen(false)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    padding: '0.65rem 1rem',
                    fontSize: '0.875rem',
                    color: 'var(--text-main)',
                  }}
                  className="interactive-tap"
                >
                  <Calendar size={16} color="var(--text-muted)" />
                  <span>Jadwal Survey &amp; Sewa</span>
                </Link>

                <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '0.35rem 0' }} />

                <button
                  onClick={handleLogout}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    width: '100%',
                    padding: '0.65rem 1rem',
                    fontSize: '0.875rem',
                    color: 'var(--status-overdue)',
                    textAlign: 'left',
                  }}
                  className="interactive-tap"
                >
                  <LogOut size={16} />
                  <span>Keluar</span>
                </button>
              </div>
            )}
          </div>
          )}
        </nav>
      </div>
    </header>
  );
};
