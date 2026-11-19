import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FEATURED_CAMPUSES } from '@kobo/shared/featured-campuses';
import { LocateFixed } from 'lucide-react';
import { PRESET_LOCATIONS } from '../../data/locations';
import { Button } from '../ui/Button';
import { HeroScene } from './HeroScene';
import { CampusSearchField } from '../search/CampusSearchField';

/* Entrance timing (animations.css, .hero-word / .hero-in): building rises first, the headline comes in
   word by word, then the search and each campus chip. --i / --d set each item's delay. */
const delay = (ms: number) => ({ '--d': `${ms}ms` }) as React.CSSProperties;
const Word: React.FC<{ i: number; children: React.ReactNode }> = ({ i, children }) => (
  <span className="hero-word" style={{ '--i': i } as React.CSSProperties}>{children}</span>
);

export const Hero: React.FC = () => {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const submitText = (text: string) => {
    const query = text.trim();
    if (!query) {
      navigate('/search');
      return;
    }

    // Only a full, exact place name becomes the reference point; anything else is searched as typed.
    const exactLocation = PRESET_LOCATIONS.find((loc) => loc.label.toLowerCase() === query.toLowerCase());

    if (exactLocation) {
      navigate(`/search?loc=${exactLocation.id}`);
    } else {
      navigate(`/search?q=${encodeURIComponent(query)}`);
    }
  };
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitText(searchInput);
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      navigate('/search');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        navigate(`/search?lat=${position.coords.latitude}&lng=${position.coords.longitude}&sort=distance_asc`),
      () => navigate('/search'),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  return (
      <section
        id="kobo-hero"
        style={{
          background: 'transparent',
          /* The glow now lives in .landing-backdrop (landing.css) on the page wrapper.
             Fill the whole viewport. The section is pulled up under the sticky
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
        }}
      >
        <div className="app-container">
          <div className="kobo-hero">
            <div className="kobo-hero__copy">
              <h1 className="kobo-hero__title" aria-label="Survey dulu, Baru sewa.">
                <span aria-hidden="true" style={{ color: 'var(--primary)' }}>
                  <Word i={0}>Survey</Word> <Word i={1}>dulu,</Word>
                </span>{' '}
                <span aria-hidden="true">
                  <Word i={2}>Baru</Word> <Word i={3}>sewa.</Word>
                </span>
              </h1>

              {/* ── Location Search Bar ── */}
              <div className="kobo-hero__search hero-in" style={delay(220)}>
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
                  <CampusSearchField
                    value={searchInput}
                    label="Cari area atau lokasi"
                    placeholder="Cari kampus atau area…"
                    onChange={setSearchInput}
                    onSubmitText={submitText}
                    onPickCampus={(branch) => navigate(`/search?campus=${encodeURIComponent(branch.id)}&sort=distance_asc`)}
                    onPickRegion={(region) => navigate(`/search?region=${encodeURIComponent(region.code)}`)}
                    onPickPoint={(p) => navigate(`/search?lat=${p.lat}&lng=${p.lng}&place=${encodeURIComponent(p.label)}&radius=3000&sort=distance_asc`)}
                    style={{ boxShadow: 'var(--shadow-md)' }}
                  />

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
              </div>

              <nav className="kobo-hero__campus-chips" aria-label="Kampus populer">
                <span className="kobo-hero__campus-lead hero-in" style={delay(300)}>
                  Cari Kos dekat kampus:
                </span>
                {FEATURED_CAMPUSES.map(({ id, label }, i) => (
                  <Link
                    key={id}
                    to={`/search?campus=${encodeURIComponent(id)}&sort=distance_asc`}
                    className="kobo-hero__campus-chip hero-in"
                    style={delay(340 + i * 30)}
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            </div>
            <HeroScene />
          </div>
        </div>
      </section>
  );
};
