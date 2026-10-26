import React from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Home,
  Star,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { useAppStore } from '../../store/AppContext';
import { useAuthActions, useSession } from '../../lib/session';
import { useTRPC } from '../../lib/trpc';
import { pickKos } from '../../lib/ownerWorkspace';
import { useOwnerBadges } from '../../lib/ownerBadges';
import type { OwnerWorkspace } from '../../lib/ownerWorkspace';
import { ErrorState } from '../ui/QueryState';
import { MobileNav } from './MobileNav';
import { Popover } from '../ui/Popover';
import '../../styles/owner-shell.css';

export const OwnerLayout: React.FC = () => {
  const { addToast } = useAppStore();
  const trpc = useTRPC();
  const [params, setParams] = useSearchParams();
  const kosQuery = useQuery(trpc.owner.myKos.queryOptions());
  const kosList = kosQuery.data ?? [];
  // The selection lives in the URL (`?kos=`), so it survives reloads and can be linked.
  const selectedKos = pickKos(kosList, params.get('kos'));
  const selectKos = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('kos', id);
    setParams(next, { replace: true });
  };
  const navSearch = selectedKos ? `?kos=${encodeURIComponent(selectedKos.id)}` : '';
  const workspace: OwnerWorkspace = { kosList, selectedKos, selectKos };
  const badges = useOwnerBadges(selectedKos?.id);
  const { me } = useSession();
  const { logout } = useAuthActions();
  const navigate = useNavigate();
  // OwnerGuard only renders this layout for a signed-in owner, so `me` is set; the fallbacks cover the sign-out frame.
  const userName = me?.user.name ?? '';
  const userEmail = me?.user.email ?? '';
  const userImage = me?.user.image ?? null;
  const initial = userName.trim().charAt(0).toUpperCase();

  const handleLogout = async () => {
    try {
      await logout();
      addToast('Anda telah keluar.', 'info');
      navigate('/');
    } catch {
      addToast('Gagal keluar. Silakan coba lagi.', 'error');
    }
  };

  const avatar = (size: number) =>
    userImage ? (
      <img src={userImage} alt={userName} className="os-avatar" style={{ width: size, height: size }} />
    ) : (
      <span aria-hidden="true" className="os-avatar os-avatar--initial" style={{ width: size, height: size }}>
        {initial}
      </span>
    );

  const brand = (
    <Link
      to={{ pathname: '/owner/dashboard', search: navSearch }}
      className="os-brand"
      aria-label="KoBo Pemilik, ke papan okupansi"
    >
      <img src="/favicon.svg" alt="" width={34} height={34} className="os-brand__mark" />
      <span className="os-brand__word">
        Ko<span>Bo</span>
      </span>
      <span className="os-brand__tag">Pemilik</span>
    </Link>
  );

  const renderKosPicker = (minWidth = '0', anchorClassName?: string) => (
    <Popover
      anchorClassName={anchorClassName}
      align="left"
      role="menu"
      label="Pilih properti aktif"
      panelClassName="kobo-menu"
      trigger={(p) => (
        <button {...p} type="button" className="kobo-control os-picker" style={{ minWidth }}>
          <span className="truncate-1 os-picker__name">{selectedKos?.name ?? 'Belum ada kos'}</span>
          <ChevronDown size={14} />
        </button>
      )}
    >
      {({ close }) => (
        <>
          {kosList.length === 0 && <span className="os-menu-empty">Belum ada kos terdaftar.</span>}
          {kosList.map((kos) => (
            <button
              key={kos.id}
              type="button"
              role="menuitemradio"
              aria-checked={kos.id === selectedKos?.id}
              onClick={() => {
                selectKos(kos.id);
                close();
              }}
            >
              <span className="os-menu-name">{kos.name}</span>
              <span className="os-menu-meta">{kos.totalRooms} kamar</span>
            </button>
          ))}
        </>
      )}
    </Popover>
  );

  const navItems = [
    { to: '/owner/dashboard', label: 'Papan okupansi', icon: <LayoutDashboard size={18} />, count: badges.dashboard, hint: 'perlu tindakan' },
    { to: '/owner/kos', label: 'Kelola properti', icon: <Home size={18} />, count: 0, hint: '' },
    { to: '/owner/reviews', label: 'Ulasan', icon: <Star size={18} />, count: badges.reviews, hint: 'belum dibalas' },
  ];

  return (
    <div className="os-root">
      <aside className="os-sidebar">
        <div className="os-sidebar__brand">{brand}</div>

        <div className="os-sidebar__picker">
          <span className="os-label">Properti aktif</span>
          {renderKosPicker('0', 'kobo-popover-anchor--block')}
        </div>

        <nav className="os-nav" aria-label="Menu pemilik">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={{ pathname: item.to, search: navSearch }}
              className={({ isActive }) => `os-nav__link${isActive ? ' is-active' : ''}`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.count > 0 && (
                <span className="os-nav__count">
                  {item.count}
                  <span className="os-sr"> {item.hint}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="os-user">
          {avatar(32)}
          <div className="os-user__text">
            <div className="os-user__name truncate-1">{userName}</div>
            <div className="os-user__email truncate-1">{userEmail}</div>
          </div>
          <button type="button" title="Keluar" aria-label="Keluar" onClick={handleLogout} className="os-logout">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <div className="os-main">
        <header className="os-mobile-header">
          {brand}
          <div className="os-mobile-user">
            {avatar(30)}
            <span>{userName.split(' ')[0]}</span>
          </div>
        </header>

        <div className="os-topbar">
          <div className="os-topbar__left">
            {/* Below 900px the sidebar is gone, so the picker lives here. */}
            <div className="os-topbar__picker">{renderKosPicker('0', 'kobo-popover-anchor--block')}</div>
            {selectedKos && <span className="os-topbar__name truncate-1">{selectedKos.name}</span>}
            {selectedKos && (
              <span className="os-badge">
                {selectedKos.occupiedRooms}/{selectedKos.totalRooms} terisi
              </span>
            )}
          </div>
        </div>

        <main className="os-main-content">
          {kosQuery.isPending ? (
            <div role="status" aria-live="polite" className="os-status">
              <span>Memuat properti Anda…</span>
            </div>
          ) : kosQuery.isError ? (
            <ErrorState message="Gagal memuat properti Anda." onRetry={() => void kosQuery.refetch()} />
          ) : (
            <Outlet context={workspace} />
          )}
        </main>
      </div>

      <MobileNav ownerBadges={badges} />
    </div>
  );
};
