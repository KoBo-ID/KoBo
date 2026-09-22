import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  User,
  LogOut,
  ChevronDown,
  Building2,
  Calendar,
  CheckCircle2,
} from 'lucide-react';
import { useAppStore } from '../../store/AppContext';

interface NavbarProps {
  onOpenAuth?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenAuth }) => {
  const location = useLocation();
  const { currentUser, rentals, visits } = useAppStore();

  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  const activeRentalsCount = rentals.filter((r) => r.paymentStatus === 'paid').length;
  const activeVisitsCount = visits.filter((v) => v.status === 'scheduled').length;

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 'var(--z-header)',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
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
            gap: '0.65rem',
            textDecoration: 'none',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--shadow-sm)',
              color: 'white',
            }}
          >
            <Building2 size={22} />
          </div>
          <div>
            <span
              style={{
                fontSize: '1.35rem',
                fontWeight: 800,
                color: 'var(--text-main)',
                letterSpacing: '-0.025em',
                lineHeight: 1,
                display: 'block',
              }}
            >
              Ko<span style={{ color: 'var(--primary)' }}>Bo</span>
            </span>
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
                letterSpacing: '0.01em',
              }}
            >
              Kos Dekat Kampus
            </span>
          </div>
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
              borderRadius: 'var(--radius-sm)',
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

          {/* User Profile Trigger */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setProfileDropdownOpen((prev) => !prev)}
              className="interactive-tap"
              aria-label="Menu Pengguna"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.2rem',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: 'transparent',
              }}
            >
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: profileDropdownOpen ? '2px solid var(--primary)' : '2px solid var(--border-subtle)',
                }}
              />
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
                    {currentUser.name}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {currentUser.email}
                  </p>
                  {currentUser.ktmVerified && (
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
                  <span>Profil &amp; Verifikasi KTM</span>
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
                  onClick={() => {
                    setProfileDropdownOpen(false);
                    if (onOpenAuth) onOpenAuth();
                  }}
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
                  <span>Ganti Akun / Masuk</span>
                </button>
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
};
