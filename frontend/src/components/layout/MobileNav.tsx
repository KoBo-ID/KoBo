import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Search, Calendar, User, Building2, Users, Star } from 'lucide-react';
import { useScheduledVisitCount } from '../../lib/visits';
import { useLiveTenancyCount } from '../../lib/booking';
import { useSession } from '../../lib/session';
import { useMatchingUnread } from '../../lib/matching';

const OWNER_WORKSPACE = ['/owner/dashboard', '/owner/kos', '/owner/reviews'];

export const MobileNav: React.FC<{ ownerBadges?: { dashboard: number; reviews: number } }> = ({ ownerBadges }) => {
  const location = useLocation();
  const { me } = useSession();
  const rentalsCount = useLiveTenancyCount();
  // Persona follows the route: the owner workspace gets the owner dock. Access to it is enforced by OwnerGuard.
  const isOwner = OWNER_WORKSPACE.includes(location.pathname);

  const visitsCount = useScheduledVisitCount();
  const totalBadges = rentalsCount + visitsCount;

  const showMatching = !me?.isOwner;
  const matchingUnread = useMatchingUnread(!!me && showMatching && (me.campusVerified || me.user.isDemo));
  const matchCount = (matchingUnread.data?.messages ?? 0) + (matchingUnread.data?.requests ?? 0);

  const kosParam = new URLSearchParams(location.search).get('kos');
  const ownerSearch = kosParam ? `?kos=${encodeURIComponent(kosParam)}` : '';

  return (
    <nav
      aria-label="Navigasi seluler"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 'var(--z-header)',
        backgroundColor: 'rgba(255, 255, 255, 0.96)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--border-subtle)',
        padding: '0.5rem 0.75rem 0.75rem',
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
              fontSize: 'var(--step--2)',
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
              fontSize: 'var(--step--2)',
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
              fontSize: 'var(--step--2)',
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
                  backgroundColor: 'var(--accent-strong)',
                  color: 'white',
                  borderRadius: '50%',
                  fontSize: 'var(--step--2)',
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

          {showMatching && (
            <Link
              to="/teman-sekamar"
              aria-label={matchCount > 0 ? `Teman Sekamar (${matchCount} belum dibaca)` : 'Teman Sekamar'}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.2rem',
                color: location.pathname.startsWith('/teman-sekamar') ? 'var(--primary)' : 'var(--text-muted)',
                fontSize: 'var(--step--2)',
                fontWeight: location.pathname.startsWith('/teman-sekamar') ? 700 : 500,
                position: 'relative',
              }}
            >
              <Users size={20} />
              <span>Teman</span>
              {matchCount > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: '-3px',
                    right: '6px',
                    minWidth: '16px',
                    height: '16px',
                    padding: '0 4px',
                    backgroundColor: 'var(--accent-strong)',
                    color: 'white',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 'var(--step--2)',
                    fontWeight: 800,
                    lineHeight: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {matchCount > 99 ? '99+' : matchCount}
                </span>
              )}
            </Link>
          )}

          <Link
            to="/profile"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/profile' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: 'var(--step--2)',
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
            to={{ pathname: '/owner/dashboard', search: ownerSearch }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/owner/dashboard' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: 'var(--step--2)',
              fontWeight: location.pathname === '/owner/dashboard' ? 700 : 500,
            }}
          >
            <span className="os-dock-icon">
              <Building2 size={20} />
              {!!ownerBadges?.dashboard && <span className="os-dock-count">{ownerBadges.dashboard}<span className="os-sr"> perlu tindakan</span></span>}
            </span>
            <span>Okupansi</span>
          </Link>

          <Link
            to={{ pathname: '/owner/kos', search: ownerSearch }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/owner/kos' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: 'var(--step--2)',
              fontWeight: location.pathname === '/owner/kos' ? 700 : 500,
            }}
          >
            <Home size={20} />
            <span>Properti</span>
          </Link>

          <Link
            to={{ pathname: '/owner/reviews', search: ownerSearch }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.2rem',
              color: location.pathname === '/owner/reviews' ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: 'var(--step--2)',
              fontWeight: location.pathname === '/owner/reviews' ? 700 : 500,
            }}
          >
            <span className="os-dock-icon">
              <Star size={20} />
              {!!ownerBadges?.reviews && <span className="os-dock-count">{ownerBadges.reviews}<span className="os-sr"> belum dibalas</span></span>}
            </span>
            <span>Ulasan</span>
          </Link>
        </>
      )}

    </nav>
  );
};
