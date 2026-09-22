import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Building2,
  LayoutDashboard,
  Home,
  Sparkles,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { useAppStore } from '../../store/AppContext';
import { MobileNav } from './MobileNav';
import { BackButton } from '../ui/BackButton';

export const OwnerLayout: React.FC = () => {
  const { kosList, selectedOwnerKosId, setSelectedOwnerKosId, currentUser } = useAppStore();
  const location = useLocation();

  const selectedKos = kosList.find((k) => k.id === selectedOwnerKosId) || kosList[0];

  const navItems = [
    { to: '/owner/dashboard', label: 'Papan Okupansi', icon: <LayoutDashboard size={18} /> },
    { to: '/owner/kos', label: 'Kelola Properti Kos', icon: <Home size={18} /> },
    { to: '/owner/reviews', label: 'Ulasan & Rating', icon: <Sparkles size={18} /> },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-page)' }}>
      {/* ── Desktop Left Sidebar (240px) ── */}
      <aside
        className="owner-desktop-sidebar"
        style={{
          width: 'var(--sidebar-width)',
          backgroundColor: 'var(--bg-surface)',
          borderRight: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 'var(--z-header)',
        }}
      >
        {/* Brand Header */}
        <div
          style={{
            height: 'var(--header-height)',
            padding: '0 1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--primary)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Building2 size={20} />
          </div>
          <div>
            <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
              Ko<span style={{ color: 'var(--primary)' }}>Bo</span> <span style={{ color: 'var(--primary)', fontSize: '0.9rem', fontWeight: 700 }}>Mitra</span>
            </span>
            <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              Portal Pengelola Kos
            </span>
          </div>
        </div>

        {/* Sidebar Property Selector */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Properti Aktif
          </label>
          <select
            value={selectedOwnerKosId}
            onChange={(e) => setSelectedOwnerKosId(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.65rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-muted)',
              color: 'var(--text-main)',
              cursor: 'pointer',
            }}
          >
            {kosList.map((kos) => (
              <option key={kos.id} value={kos.id}>
                {kos.name} ({kos.rooms.length} kamar)
              </option>
            ))}
          </select>
        </div>

        {/* Navigation Tree */}
        <nav style={{ flex: 1, padding: '1.25rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', overflowY: 'auto' }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.65rem 0.85rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.875rem',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? 'var(--primary)' : 'var(--text-main)',
                backgroundColor: isActive ? 'var(--primary-light)' : 'transparent',
                transition: 'background-color var(--duration-fast)',
              })}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom: User Identity + Logout — NO "Portal Mahasiswa" link */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-muted)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0 0.25rem' }}>
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
            />
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)' }} className="truncate-1">
                {currentUser.name}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 600 }}>
                Mitra Pemilik Aktif
              </div>
            </div>
            <button
              title="Keluar"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)',
                flexShrink: 0,
              }}
              className="interactive-tap"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content Area ── */}
      <div
        className="owner-main-workspace"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {/* ── Mobile-only Header (no Portal Mahasiswa link) ── */}
        <header
          className="owner-mobile-header"
          style={{
            height: '60px',
            backgroundColor: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 1rem',
            position: 'sticky',
            top: 0,
            zIndex: 'var(--z-header)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--primary)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Building2 size={18} />
            </div>
            <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)' }}>
              Ko<span style={{ color: 'var(--primary)' }}>Bo</span> <span style={{ color: 'var(--primary)', fontSize: '0.85rem' }}>Mitra</span>
            </span>
          </div>

          {/* Mobile: current user avatar only */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              style={{ width: '30px', height: '30px', borderRadius: '50%', objectFit: 'cover' }}
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
              {currentUser.name.split(' ')[0]}
            </span>
          </div>
        </header>

        {/* ── Persistent Active Property Top Bar (Issue 12) ── */}
        <div
          className="owner-property-topbar"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-subtle)',
            padding: '0.65rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            position: 'sticky',
            top: '60px',
            zIndex: 'calc(var(--z-header) - 1)',
            flexShrink: 0,
          }}
        >
          {/* Left: current section breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={15} color="var(--text-muted)" />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Ruang Kerja Pemilik Kos
            </span>
          </div>

          {/* Right: Properti Aktif selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Properti Aktif:
            </span>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <select
                value={selectedOwnerKosId}
                onChange={(e) => setSelectedOwnerKosId(e.target.value)}
                style={{
                  padding: '0.4rem 2rem 0.4rem 0.85rem',
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  borderRadius: 'var(--radius-md)',
                  border: '1.5px solid var(--primary)',
                  backgroundColor: 'var(--primary-subtle)',
                  color: 'var(--primary)',
                  cursor: 'pointer',
                  appearance: 'none',
                  minWidth: '200px',
                  maxWidth: '320px',
                }}
              >
                {kosList.map((kos) => (
                  <option key={kos.id} value={kos.id}>
                    {kos.name} — {kos.rooms.length} kamar
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                color="var(--primary)"
                style={{ position: 'absolute', right: '0.6rem', pointerEvents: 'none' }}
              />
            </div>
            {selectedKos && (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  backgroundColor: 'var(--primary-light)',
                  color: 'var(--primary)',
                  padding: '0.2rem 0.55rem',
                  borderRadius: 'var(--radius-badge)',
                  whiteSpace: 'nowrap',
                }}
              >
                {selectedKos.rooms.filter(r => r.status !== 'vacant').length}/{selectedKos.rooms.length} terisi
              </span>
            )}
          </div>
        </div>

        <main style={{ flex: 1 }}>
          <div className="app-container" style={{ paddingTop: '1rem' }}>
            <BackButton />
          </div>
          <Outlet />
        </main>
      </div>

      <MobileNav />

      <style>{`
        @media (min-width: 900px) {
          .owner-desktop-sidebar {
            display: flex !important;
          }
          .owner-main-workspace {
            margin-left: var(--sidebar-width);
          }
          .owner-mobile-header {
            display: none !important;
          }
          .owner-property-topbar {
            top: 0 !important;
          }
        }
        @media (max-width: 899px) {
          .owner-desktop-sidebar {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};
