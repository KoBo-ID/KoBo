import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Search, Calendar, User, Building2 } from 'lucide-react';
import { useScheduledVisitCount } from '../../lib/visits';
import { useLiveTenancyCount } from '../../lib/booking';

const OWNER_WORKSPACE = ['/owner/dashboard', '/owner/kos', '/owner/reviews'];

export const MobileNav: React.FC = () => {
  const location = useLocation();
  const rentalsCount = useLiveTenancyCount();
  // Persona follows the route: the owner workspace gets the owner dock. Access to it is enforced by OwnerGuard.
  const isOwner = OWNER_WORKSPACE.includes(location.pathname);

  const visitsCount = useScheduledVisitCount();
  const totalBadges = rentalsCount + visitsCount;

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
            to={{ pathname: '/owner/dashboard', search: location.search }}
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
            to={{ pathname: '/owner/kos', search: location.search }}
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
            to={{ pathname: '/owner/reviews', search: location.search }}
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
