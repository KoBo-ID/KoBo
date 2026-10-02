import React, { useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Building2, MapPin, LocateFixed, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib/trpc';
import { PRESET_LOCATIONS } from '../../data/locations';
import { Button } from '../ui/Button';
import { HeroScene } from './HeroScene';

const DESKTOP_QUERY = '(min-width: 1024px)';
function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const getDesktopServer = () => false;

export const Hero: React.FC = () => {
  const navigate = useNavigate();
  const trpc = useTRPC();
  // Same query (and cache entry) as FeaturedKos: one request feeds both.
  const { data } = useQuery(trpc.kos.list.queryOptions());
  const kosList = data ?? [];
  // Copy is left-aligned beside the canvas on desktop, centred when stacked.
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktop, getDesktopServer);

  const [searchInput, setSearchInput] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const trimmedInput = searchInput.trim().toLowerCase();

  const matchedLocations = PRESET_LOCATIONS.filter(
    (loc) =>
      !trimmedInput ||
      loc.label.toLowerCase().includes(trimmedInput) ||
      loc.city.toLowerCase().includes(trimmedInput) ||
      loc.aliases?.some((alias) => alias.includes(trimmedInput))
  );

  const matchedKos = trimmedInput
    ? kosList.filter(
        (kos) =>
          kos.name.toLowerCase().includes(trimmedInput) ||
          kos.district.toLowerCase().includes(trimmedInput) ||
          kos.city.toLowerCase().includes(trimmedInput)
      )
    : [];

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchInput.trim();
    if (!query) {
      navigate('/search');
      return;
    }

    const exactLocation = PRESET_LOCATIONS.find(
      (loc) =>
        loc.label.toLowerCase() === query.toLowerCase() ||
        loc.aliases?.some((alias) => alias === query.toLowerCase())
    );

    if (exactLocation) {
      navigate(`/search?loc=${exactLocation.id}`);
    } else {
      navigate(`/search?q=${encodeURIComponent(query)}`);
    }
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      navigate('/search');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        navigate(`/search?lat=${position.coords.latitude}&lng=${position.coords.longitude}`),
      () => navigate('/search'),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  return (
      <section
        id="kobo-hero"
        style={{
          background: 'radial-gradient(110% 110% at 50% 0%, hsla(176, 55%, 94%, 0.85) 0%, var(--bg-page) 100%)',
          /* Fill the whole viewport. The section is pulled up under the sticky
             navbar by exactly its height and padded back down by the same
             amount, so the gradient runs behind the transparent bar while the
             content position is unchanged. Navbar.tsx watches #kobo-hero to
             know when to turn solid. */
          minHeight: '100svh',
          marginTop: 'calc(-1 * var(--header-height))',
          paddingTop: 'calc(var(--header-height) + 1.5rem)',
          paddingBottom: '2.5rem',
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="app-container">
          <div className="kobo-hero">
            <div style={{ textAlign: isDesktop ? 'left' : 'center', minWidth: 0 }}>
              {/* Tagline */}
              <span
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  color: 'var(--primary)',
                  marginBottom: '1rem',
                }}
              >
                Kos Booking with KoBo
              </span>
    
    
              <h1
                style={{
                  fontSize: '2.6rem',
                  fontWeight: 800,
                  color: 'var(--text-main)',
                  letterSpacing: '-0.03em',
                  lineHeight: 1.15,
                  marginBottom: '0.9rem',
                }}
              >
                Cari Kos Terverifikasi,{' '}
                <span style={{ color: 'var(--primary)' }}>Survey Dulu</span>, Baru Sewa.
              </h1>
    
              <p
                style={{
                  fontSize: '1.02rem',
                  color: 'var(--text-muted)',
                  lineHeight: 1.6,
                  marginBottom: '2.25rem',
                  maxWidth: '560px',
                  marginLeft: isDesktop ? 0 : 'auto',
                  marginRight: isDesktop ? 0 : 'auto',
                }}
              >
                Tentukan titik lokasimu, lihat kos dan kampus terdekat di peta, lalu sewa dengan aturan yang tertulis jelas. Untuk mahasiswa maupun pekerja.
              </p>
    
              {/* ── Location Search Bar ── */}
              <div
                style={{ position: 'relative', maxWidth: '660px', margin: isDesktop ? 0 : '0 auto' }}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setSuggestionsOpen(false);
                }}
              >
                {/* Three SIBLING controls, matching the Search page bar:
                    the field shell holds only the icon and the input, while the
                    geolocation and submit buttons sit OUTSIDE it. Nesting
                    bordered controls inside the field is what made the search
                    area read as cluttered. */}
                <form
                  id="hero-search-form"
                  onSubmit={handleSearchSubmit}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <div className="kobo-searchfield" style={{ boxShadow: 'var(--shadow-md)' }}>
                    <Search size={18} />
                    <input
                      id="hero-search-input"
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onFocus={() => setSuggestionsOpen(true)}
                      placeholder="Cari area, lokasi, atau nama kos..."
                      aria-label="Cari area, lokasi, atau nama kos"
                    />
                    {searchInput && (
                      <button
                        type="button"
                        className="kobo-searchfield__clear"
                        onClick={() => setSearchInput('')}
                        aria-label="Bersihkan pencarian"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleUseMyLocation}
                    className="kobo-icon-btn hide-on-mobile"
                    title="Gunakan lokasi saya"
                    aria-label="Gunakan lokasi saya"
                    style={{ height: 'var(--control-height-lg)', width: 'var(--control-height-lg)' }}
                  >
                    <LocateFixed size={17} />
                  </button>

                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    style={{ flexShrink: 0, height: 'var(--control-height-lg)' }}
                  >
                    Cari Kos
                  </Button>
                </form>
    
                {/* Autocomplete Dropdown */}
                {suggestionsOpen && (matchedLocations.length > 0 || matchedKos.length > 0) && (
                  <div
                    className="animate-slide-up"
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 8px)',
                      left: 0,
                      right: 0,
                      backgroundColor: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-xl)',
                      overflow: 'hidden',
                      boxShadow: 'var(--shadow-xl)',
                      border: '1px solid var(--border-subtle)',
                      padding: '0.4rem 0',
                      zIndex: 'var(--z-dropdown)',
                      textAlign: 'left',
                    }}
                  >
                    {matchedLocations.slice(0, 4).map((loc) => (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => navigate(`/search?loc=${loc.id}`)}
                        className="interactive-tap"
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          padding: '0.65rem 1.25rem',
                          textAlign: 'left',
                        }}
                      >
                        <MapPin size={17} color="var(--primary)" style={{ flexShrink: 0 }} />
                        <span>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)', display: 'block' }}>
                            {loc.label}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {loc.area === loc.label ? loc.city : `${loc.area}, ${loc.city}`} · Jadikan titik acuan peta
                          </span>
                        </span>
                      </button>
                    ))}
                    {matchedKos.slice(0, 3).map((kos) => (
                      <button
                        key={kos.id}
                        type="button"
                        onClick={() => navigate(`/kos/${kos.id}`)}
                        className="interactive-tap"
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          padding: '0.65rem 1.25rem',
                          textAlign: 'left',
                        }}
                      >
                        <Building2 size={17} color="var(--text-subtle)" style={{ flexShrink: 0 }} />
                        <span style={{ minWidth: 0 }}>
                          <span className="truncate-1" style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)', display: 'block' }}>
                            {kos.name}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {kos.district}, {kos.city}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <HeroScene />
          </div>
        </div>

        {/* Scoped focus-within glow (Issue 5) */}
        <style>{`
        `}</style>
      </section>
  );
};
