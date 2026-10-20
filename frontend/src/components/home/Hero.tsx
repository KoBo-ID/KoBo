import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocateFixed } from 'lucide-react';
import { PRESET_LOCATIONS } from '../../data/locations';
import { Button } from '../ui/Button';
import { HeroScene } from './HeroScene';
import { CampusSearchField } from '../search/CampusSearchField';

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
            <div className="kobo-hero__copy">
              <h1 className="kobo-hero__title hero-enter">
                <span style={{ color: 'var(--primary)' }}>Survey dulu</span>, baru ajukan sewa.
              </h1>

              <p className="kobo-hero__sub hero-enter">
                Lihat kos dan kampus terdekat di peta, baca aturan tertulisnya, lalu ajukan sewa untuk disetujui pemilik.
              </p>

              {/* ── Location Search Bar ── */}
              <div className="kobo-hero__search hero-enter">
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
                    placeholder="Cari area atau lokasi..."
                    onChange={setSearchInput}
                    onSubmitText={submitText}
                    onPickCampus={(branch) => navigate(`/search?campus=${encodeURIComponent(branch.id)}&sort=distance_asc`)}
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
            </div>
            <HeroScene />
          </div>
        </div>
      </section>
  );
};
