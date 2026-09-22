import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search as SearchIcon,
  Filter,
  MapPin,
  Sparkles,
  CheckCircle2,
  Calendar,
  X,
  SlidersHorizontal,
  ChevronDown,
  Map,
  List,
} from 'lucide-react';
import { useAppStore } from '../store/AppContext';
import { CAMPUSES } from '../data/campuses';
import { ListingCard } from '../components/kos/ListingCard';
import { LeafletMap } from '../components/kos/LeafletMap';
import { Button } from '../components/ui/Button';
import { useResizeObserver } from '../hooks/useResizeObserver';

export const Search: React.FC = () => {
  const [searchParams] = useSearchParams();
  const {
    kosList,
    searchQuery,
    setSearchQuery,
    selectedCampusId,
    setSelectedCampusId,
    genderFilter,
    setGenderFilter,
    sortBy,
    setSortBy,
    maxPrice,
    setMaxPrice,
    filterDiscountOnly,
    setFilterDiscountOnly,
    filterSurveyOnly,
    setFilterSurveyOnly,
    hoveredKosId,
    setHoveredKosId,
  } = useAppStore();

  const [mobileViewMode, setMobileViewMode] = useState<'list' | 'map'>('list');
  const filterBarRef = useRef<HTMLDivElement>(null);
  const filterBarDimensions = useResizeObserver(filterBarRef);
  const filterBarHeight = Math.max(filterBarDimensions.height, 64);

  // Sync campus from URL query param if present
  useEffect(() => {
    const campusParam = searchParams.get('campus');
    if (campusParam) {
      setSelectedCampusId(campusParam);
    }
  }, [searchParams, setSelectedCampusId]);

  // Filter Algorithm
  const filteredKos = kosList.filter((kos) => {
    if (selectedCampusId && kos.campusProximity.campusId !== selectedCampusId) {
      return false;
    }
    if (genderFilter !== 'all' && kos.gender !== genderFilter) {
      return false;
    }
    if (kos.priceMonthlyStart > maxPrice) {
      return false;
    }
    if (filterDiscountOnly && kos.studentDiscountAmount <= 0) {
      return false;
    }
    if (filterSurveyOnly) {
      const hasSurvey = kos.rooms.some((r) => r.status === 'vacant');
      if (!hasSurvey) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = kos.name.toLowerCase().includes(q);
      const matchAddress = kos.address.toLowerCase().includes(q);
      const matchDistrict = kos.district.toLowerCase().includes(q);
      const matchAmenities = [...kos.privateAmenities, ...kos.sharedAmenities].some((a) =>
        a.toLowerCase().includes(q)
      );
      if (!matchName && !matchAddress && !matchDistrict && !matchAmenities) {
        return false;
      }
    }
    return true;
  });

  // Sorting
  const sortedKos = [...filteredKos].sort((a, b) => {
    if (sortBy === 'rating') {
      return b.rating - a.rating;
    }
    if (sortBy === 'price_asc') {
      return a.priceMonthlyStart - b.priceMonthlyStart;
    }
    if (sortBy === 'distance_asc') {
      return a.campusProximity.distanceMeters - b.campusProximity.distanceMeters;
    }
    return 0;
  });

  const selectedCampus = CAMPUSES.find((c) => c.id === selectedCampusId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - var(--header-height))' }}>
      {/* Refactored Sticky Filter Bar - Dynamic height tracking, no pill input slop */}
      <div
        ref={filterBarRef}
        style={{
          position: 'sticky',
          top: 'var(--header-height)',
          zIndex: 'var(--z-sticky)',
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.85rem 0',
          boxShadow: 'var(--shadow-xs)',
        }}
      >
        <div className="app-container" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Row 1: Primary Search Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flex: 1, minWidth: '280px' }}>
              {/* Campus Selector - 8px radius */}
              <select
                value={selectedCampusId}
                onChange={(e) => setSelectedCampusId(e.target.value)}
                style={{
                  padding: '0.5rem 0.85rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--border-strong)',
                  backgroundColor: 'var(--bg-page)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                  maxWidth: '240px',
                }}
              >
                <option value="">🎓 Semua Kampus</option>
                {CAMPUSES.map((c) => (
                  <option key={c.id} value={c.id}>
                    🎓 {c.shortName}
                  </option>
                ))}
              </select>

              {/* Text Search Input - 8px radius */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-input)',
                  padding: '0.45rem 0.85rem',
                  flex: 1,
                  maxWidth: '380px',
                }}
              >
                <SearchIcon size={16} color="var(--primary)" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari jalan, nama kos, fasilitas..."
                  style={{
                    border: 'none',
                    outline: 'none',
                    backgroundColor: 'transparent',
                    fontSize: '0.85rem',
                    width: '100%',
                    fontFamily: 'var(--font-sans)',
                  }}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} style={{ color: 'var(--text-subtle)' }}>
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Sort Selector - 8px radius */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Urutkan:
              </span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: 'var(--radius-btn)',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-muted)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <option value="rating">⭐ Rating Tertinggi</option>
                <option value="price_asc">💰 Harga Terendah</option>
                <option value="distance_asc">🚶 Paling Dekat Kampus</option>
              </select>
            </div>
          </div>

          {/* Row 2: Secondary Filter Chips (6px radius tags) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {/* Gender Chips */}
              {(
                [
                  { id: 'all', label: 'Semua Tipe' },
                  { id: 'campur', label: 'Campur' },
                  { id: 'putri', label: 'Khusus Putri' },
                  { id: 'putra', label: 'Khusus Putra' },
                ] as const
              ).map((item) => {
                const isActive = genderFilter === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setGenderFilter(item.id)}
                    className="interactive-tap"
                    style={{
                      padding: '0.3rem 0.65rem',
                      borderRadius: 'var(--radius-badge)',
                      fontSize: '0.78rem',
                      fontWeight: isActive ? 700 : 500,
                      backgroundColor: isActive ? 'var(--text-main)' : 'var(--bg-muted)',
                      color: isActive ? 'white' : 'var(--text-muted)',
                      border: '1px solid',
                      borderColor: isActive ? 'var(--text-main)' : 'var(--border-subtle)',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}

              <div style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-subtle)', margin: '0 0.2rem' }} />

              {/* Student Discount Toggle Chip */}
              <button
                onClick={() => setFilterDiscountOnly(!filterDiscountOnly)}
                className="interactive-tap"
                style={{
                  padding: '0.3rem 0.65rem',
                  borderRadius: 'var(--radius-badge)',
                  fontSize: '0.78rem',
                  fontWeight: filterDiscountOnly ? 700 : 500,
                  backgroundColor: filterDiscountOnly ? 'var(--accent-light)' : 'var(--bg-muted)',
                  color: filterDiscountOnly ? 'var(--accent)' : 'var(--text-muted)',
                  border: '1px solid',
                  borderColor: filterDiscountOnly ? 'hsla(24, 95%, 53%, 0.3)' : 'var(--border-subtle)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <span>🎓 Diskon KTM</span>
              </button>

              {/* Free Visit Toggle Chip */}
              <button
                onClick={() => setFilterSurveyOnly(!filterSurveyOnly)}
                className="interactive-tap"
                style={{
                  padding: '0.3rem 0.65rem',
                  borderRadius: 'var(--radius-badge)',
                  fontSize: '0.78rem',
                  fontWeight: filterSurveyOnly ? 700 : 500,
                  backgroundColor: filterSurveyOnly ? 'var(--primary-light)' : 'var(--bg-muted)',
                  color: filterSurveyOnly ? 'var(--primary)' : 'var(--text-muted)',
                  border: '1px solid',
                  borderColor: filterSurveyOnly ? 'hsla(158, 64%, 32%, 0.3)' : 'var(--border-subtle)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <span>📅 Bisa Survey Gratis</span>
              </button>
            </div>

            {/* Price Cap Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Maks. Sewa:</span>
              <input
                type="range"
                min="800000"
                max="3500000"
                step="100000"
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                style={{ width: '100px', accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Rp {(maxPrice / 1000000).toFixed(1).replace('.', ',')}jt
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area: Desktop Split View */}
      <div className="app-container" style={{ flex: 1, paddingBottom: '3rem', paddingTop: '1.25rem' }}>
        <div
          className="search-split-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '2rem',
            alignItems: 'start',
          }}
        >
          {/* Left Column (55% on Desktop): Listing Cards Feed */}
          <div
            className="search-feed-column"
            style={{
              display: mobileViewMode === 'map' ? 'none' : 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
            }}
          >
            {/* Header info */}
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {selectedCampus ? `Kos Dekat ${selectedCampus.shortName}` : 'Semua Kos Dekat Kampus'}
                </h1>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Menampilkan <strong>{sortedKos.length}</strong> pilihan kamar terverifikasi
                </p>
              </div>

              {(selectedCampusId || genderFilter !== 'all' || searchQuery || filterDiscountOnly || filterSurveyOnly) && (
                <button
                  onClick={() => {
                    setSelectedCampusId('');
                    setGenderFilter('all');
                    setSearchQuery('');
                    setFilterDiscountOnly(false);
                    setFilterSurveyOnly(false);
                  }}
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: 'var(--accent)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <X size={13} />
                  <span>Reset Filter</span>
                </button>
              )}
            </div>

            {/* Listings Grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {sortedKos.map((kos) => (
                <div
                  key={kos.id}
                  onMouseEnter={() => setHoveredKosId(kos.id)}
                  onMouseLeave={() => setHoveredKosId(null)}
                >
                  <ListingCard kos={kos} />
                </div>
              ))}
            </div>

            {/* Empty State with Helpful CTAs */}
            {sortedKos.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '4rem 1.5rem',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-card)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <MapPin size={40} color="var(--text-subtle)" style={{ margin: '0 auto 1rem' }} />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Tidak ada kos yang cocok</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.35rem', maxWidth: '380px', margin: '0.35rem auto 1.5rem' }}>
                  Coba perluas radius pencarian atau kurangi kriteria filter untuk melihat lebih banyak kos mahasiswa.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedCampusId('');
                    setGenderFilter('all');
                    setMaxPrice(3000000);
                    setSearchQuery('');
                    setFilterDiscountOnly(false);
                    setFilterSurveyOnly(false);
                  }}
                >
                  Reset Semua Filter
                </Button>
              </div>
            )}
          </div>

          {/* Right Column (45% on Desktop): Sticky Real Leaflet Map */}
          <div
            className="search-map-column"
            style={{
              display: mobileViewMode === 'list' ? 'none' : 'block',
              position: 'sticky',
              top: `calc(var(--header-height) + ${filterBarHeight}px + 1rem)`,
              height: `calc(100vh - var(--header-height) - ${filterBarHeight}px - 2rem)`,
              minHeight: '480px',
            }}
          >
            <LeafletMap
              kosList={sortedKos}
              selectedCampusId={selectedCampusId}
              hoveredKosId={hoveredKosId}
              onHoverKos={setHoveredKosId}
            />
          </div>
        </div>
      </div>

      {/* Floating Mobile Map/List Toggle Button */}
      <div
        style={{
          position: 'fixed',
          bottom: '5rem',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 35,
        }}
        className="mobile-map-toggle"
      >
        <button
          onClick={() => setMobileViewMode(mobileViewMode === 'list' ? 'map' : 'list')}
          className="interactive-tap"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: 'var(--text-main)',
            color: 'white',
            padding: '0.65rem 1.25rem',
            borderRadius: 'var(--radius-btn)',
            fontSize: '0.875rem',
            fontWeight: 700,
            boxShadow: 'var(--shadow-xl)',
            border: 'none',
          }}
        >
          {mobileViewMode === 'list' ? (
            <>
              <Map size={18} />
              <span>Lihat Peta</span>
            </>
          ) : (
            <>
              <List size={18} />
              <span>Lihat Daftar</span>
            </>
          )}
        </button>
      </div>

      {/* Responsive Split View Media Queries */}
      <style>{`
        @media (min-width: 1024px) {
          .search-split-grid {
            grid-template-columns: 55fr 45fr !important;
          }
          .search-feed-column {
            display: flex !important;
          }
          .search-map-column {
            display: block !important;
          }
          .mobile-map-toggle {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
};
