import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Search, Calendar, User, Building2 } from 'lucide-react';
import { useAppStore } from '../../store/AppContext';

export const MobileNav: React.FC = () => {
  const location = useLocation();
  const { activePersona, rentals, visits } = useAppStore();
  const isOwner = activePersona === 'owner';

  const totalBadges = rentals.filter((r) => r.paymentStatus === 'paid').length + visits.filter((v) => v.status === 'scheduled').length;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 'var(--z-header)',
        backgroundColor: 'rgba(255, 255, 255, 0.96)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--border-subtle)',
        padding: '0.5rem 1rem 0.75rem',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
      }}
      className="mobile-only-dock"
    >
      {!isOwner ? (
        <>
          <Link
            to="/"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: '0.7rem',
              fontWeight: location.pathname === '/' ? 700 : 500,
            }}
          >
            <Home size={20} />
            <span>Beranda</span>
          </Link>

          <Link
            to="/search"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/search' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: '0.7rem',
              fontWeight: location.pathname === '/search' ? 700 : 500,
            }}
          >
            <Search size={20} />
            <span>Cari</span>
          </Link>

          <Link
            to="/my-kos"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/my-kos' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: '0.7rem',
              fontWeight: location.pathname === '/my-kos' ? 700 : 500,
              position: 'relative',
            }}
          >
            <Calendar size={20} />
            <span>Kos Saya</span>
            {totalBadges > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-3px',
                  right: '6px',
                  width: '16px',
                  height: '16px',
                  backgroundColor: 'var(--accent)',
                  color: 'white',
                  borderRadius: '50%',
                  fontSize: '0.6rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {totalBadges}
              </span>
            )}
          </Link>

          <Link
            to="/profile"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/profile' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: '0.7rem',
              fontWeight: location.pathname === '/profile' ? 700 : 500,
            }}
          >
            <User size={20} />
            <span>Profil</span>
          </Link>
        </>
      ) : (
        <>
          <Link
            to="/owner/dashboard"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/owner/dashboard' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: '0.7rem',
              fontWeight: location.pathname === '/owner/dashboard' ? 700 : 500,
            }}
          >
            <Building2 size={20} />
            <span>Papan Kamar</span>
          </Link>

          <Link
            to="/owner/kos"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/owner/kos' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: '0.7rem',
              fontWeight: location.pathname === '/owner/kos' ? 700 : 500,
            }}
          >
            <Home size={20} />
            <span>Kelola Kos</span>
          </Link>

          <Link
            to="/owner/reviews"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/owner/reviews' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: '0.7rem',
              fontWeight: location.pathname === '/owner/reviews' ? 700 : 500,
            }}
          >
            <User size={20} />
            <span>Ulasan</span>
          </Link>
        </>
      )}

      <style>{`
        @media (min-width: 768px) {
          .mobile-only-dock {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};
