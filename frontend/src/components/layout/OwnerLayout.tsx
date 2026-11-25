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
import { Skeleton } from '../ui/Skeleton';
import { Modal } from '../ui/Modal';
import { OwnerDocsStep } from '../auth/OwnerDocsStep';
import { useOwnerGate, useOwnerVerification } from '../../lib/owner';
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
  const gate = useOwnerGate();
  const verification = useOwnerVerification();
  const ownerStatus = gate.status;
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
      panelClassName="kobo-menu os-picker-menu"
      trigger={(p) => (
        <button {...p} type="button" className="kobo-control os-picker" style={{ minWidth }}>
          <span className="os-picker__name" title={selectedKos?.name}>{kosQuery.isPending ? <Skeleton width="9rem" height="1rem" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> : (selectedKos?.name ?? 'Belum ada kos')}</span>
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
                <span className={`os-nav__count${item.to === '/owner/dashboard' ? ' os-nav__count--danger' : ''}`}>
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
            <span title={userName} className="os-mobile-user__name">{userName}</span>
            <button
              type="button"
              title="Keluar"
              aria-label="Keluar"
              onClick={handleLogout}
              className="os-logout"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <div className="os-topbar">
          <div className="os-topbar__left">
            {/* The active kos lives here at every width, so long names show in full. One kos: plain name. */}
            {kosList.length > 1 ? (
              <div className="os-topbar__picker">{renderKosPicker('0', 'kobo-popover-anchor--block')}</div>
            ) : (
              <span className="os-topbar__name">{kosQuery.isPending ? <Skeleton width="9rem" height="1rem" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> : (selectedKos?.name ?? 'Belum ada kos')}</span>
            )}
            {selectedKos && (
              <span className="os-badge">
                {selectedKos.occupiedRooms}/{selectedKos.totalRooms} terisi
              </span>
            )}
          </div>
        </div>

        {ownerStatus && ownerStatus !== 'DISETUJUI' && (
          <div className={`os-banner os-banner--action${ownerStatus === 'DITOLAK' ? ' os-banner--warn' : ''}`} role="status" data-testid="owner-status-banner">
            <div className="os-banner__text">
              {ownerStatus === 'BELUM_KIRIM' && <strong>Lengkapi dokumen untuk mulai mendaftarkan kos</strong>}
              {ownerStatus === 'MENUNGGU' && (
                <strong>
                  Dokumen sedang diperiksa{verification.data ? ` · ${verification.data.slaText}` : verification.isError ? '' : ' · memuat…'}
                </strong>
              )}
              {ownerStatus === 'DITOLAK' && (
                <>
                  <strong>Dokumen ditolak</strong>
                  <span>{verification.data?.reason ?? (verification.isPending ? 'Memuat alasan…' : 'Unggah ulang dokumen yang diminta.')}</span>
                </>
              )}
              {kosList.length > 0 && <span>Kos yang sudah Anda buat tetap tersimpan; kos baru bisa dibuat setelah dokumen disetujui.</span>}
            </div>
            {ownerStatus === 'BELUM_KIRIM' && <button type="button" className="os-banner__btn" onClick={gate.openDocs}>Lengkapi dokumen</button>}
            {ownerStatus === 'DITOLAK' && <button type="button" className="os-banner__btn" onClick={gate.openDocs}>Unggah ulang</button>}
          </div>
        )}

        <main id="main" tabIndex={-1} className="os-main-content">
          {kosQuery.isPending ? (
            <div role="status" aria-busy="true" aria-label="Memuat properti Anda" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-s)', paddingBlock: 'var(--space-s)' }}>
              <Skeleton width="16rem" height="2rem" />
              <Skeleton width="100%" height="7rem" borderRadius="var(--radius-card)" />
              <Skeleton width="100%" height="12rem" borderRadius="var(--radius-card)" />
            </div>
          ) : kosQuery.isError ? (
            <ErrorState message="Gagal memuat properti Anda." onRetry={() => void kosQuery.refetch()} />
          ) : (
            <Outlet context={workspace} />
          )}
        </main>
      </div>

      {gate.docsOpen && !gate.approved && (
        <Modal isOpen onClose={gate.closeDocs} title="Dokumen (bisa nanti)" subtitle="Verifikasi pemilik" maxWidth="md">
          <OwnerDocsStep onDone={gate.closeDocs} onLater={gate.closeDocs} />
        </Modal>
      )}

      <MobileNav ownerBadges={badges} />
    </div>
  );
};
