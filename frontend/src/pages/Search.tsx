import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search as SearchIcon,
  MapPin,
  GraduationCap,
  CalendarCheck,
  X,
  Map as MapIcon,
  List,
  LocateFixed,
  Building2,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
import { useAppStore } from '../store/AppContext';
import { CAMPUSES } from '../data/campuses';
import { PRESET_LOCATIONS } from '../data/locations';
import { ListingCard } from '../components/kos/ListingCard';
import { LeafletMap } from '../components/kos/LeafletMap';
import { Button } from '../components/ui/Button';
import { Popover } from '../components/ui/Popover';
import { useResizeObserver } from '../hooks/useResizeObserver';
import { Kos, LocationPin } from '../types';
import { averageLatLng, formatDistance, haversineMeters } from '../utils/geo';

const PRICE_MIN = 800000;
const PRICE_MAX = 3500000;
const PRICE_STEP = 100000;
const RADIUS_METERS = 5000;
const NEARBY_CAMPUS_METERS = 3000;

type Suggestion =
  | { type: 'location'; location: LocationPin }
  | { type: 'kos'; kos: Kos };

const formatJuta = (value: number) => {
  const juta = value / 1000000;
  const formatted = Number.isInteger(juta) ? `${juta}` : juta.toFixed(1).replace('.', ',');
  return `Rp ${formatted}jt`;
};

const priceFillPercent = (value: number) =>
  `${((value - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100}%`;

export const Search: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    kosList,
    searchQuery,
    setSearchQuery,
    activeLocation,
    setActiveLocation,
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
  const [locationInput, setLocationInput] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const filterBarDimensions = useResizeObserver(filterBarRef);
  const filterBarHeight = Math.max(filterBarDimensions.height, 112);
  const hydratedRef = useRef(false);

  // Derived location pins from kos districts (keeps new listings searchable)
  const areaLocations = useMemo<LocationPin[]>(() => {
    const groups = new Map<string, Kos[]>();
    kosList.forEach((kos) => {
      const key = `${kos.district}|${kos.city}`;
      groups.set(key, [...(groups.get(key) || []), kos]);
    });

    const result: LocationPin[] = [];
    groups.forEach((items, key) => {
      const [district, city] = key.split('|');
      const center = averageLatLng(items.map((kos) => kos.coordinates));
      if (!center) return;
      result.push({
        id: `area-${district.toLowerCase().replace(/\s+/g, '-')}`,
        label: district,
        area: district,
        city,
        coordinates: center,
        source: 'kos',
        aliases: [district, city],
      });
    });
    return result;
  }, [kosList]);

  const allLocations = useMemo(() => {
    const presetLabels = new Set(PRESET_LOCATIONS.map((loc) => loc.label.toLowerCase()));
    return [
      ...PRESET_LOCATIONS,
      ...areaLocations.filter((loc) => !presetLabels.has(loc.label.toLowerCase())),
    ];
  }, [areaLocations]);

  // Hydrate search state from URL once
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const locParam = searchParams.get('loc');
    const qParam = searchParams.get('q');
    const latParam = searchParams.get('lat');
    const lngParam = searchParams.get('lng');
    if (locParam) {
      const found = allLocations.find((loc) => loc.id === locParam);
      if (found) {
        setActiveLocation(found);
        setLocationInput(found.label);
      }
    }
    if (latParam && lngParam) {
      const geoLocation: LocationPin = {
        id: 'geo-me',
        label: 'Lokasi Saya',
        area: 'Sekitar Anda',
        city: 'Radius 5 km',
        coordinates: { lat: Number(latParam), lng: Number(lngParam) },
        source: 'geolocation',
      };
      setActiveLocation(geoLocation);
      setLocationInput(geoLocation.label);
    }
    if (qParam) setSearchQuery(qParam);
  }, [searchParams, allLocations, setActiveLocation, setSearchQuery]);

  const applyLocation = (location: LocationPin | null) => {
    setActiveLocation(location);
    setLocationInput(location ? location.label : '');
    setSuggestionsOpen(false);
    setSearchParams(location ? { loc: location.id } : {}, { replace: true });
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      applyLocation(null);
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        const myLocation: LocationPin = {
          id: 'geo-me',
          label: 'Lokasi Saya',
          area: 'Sekitar Anda',
          city: 'Radius 5 km',
          coordinates: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          source: 'geolocation',
        };
        applyLocation(myLocation);
      },
      () => {
        setIsLocating(false);
        applyLocation(null);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const distanceFor = (kos: Kos) =>
    activeLocation
      ? haversineMeters(activeLocation.coordinates, kos.coordinates)
      : kos.campusProximity.distanceMeters;

  // Filter algorithm
  const filteredKos = kosList.filter((kos) => {
    if (activeLocation && haversineMeters(activeLocation.coordinates, kos.coordinates) > RADIUS_METERS) {
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
    if (filterSurveyOnly && !kos.rooms.some((r) => r.status === 'vacant')) {
      return false;
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

  const sortedKos = [...filteredKos].sort((a, b) => {
    if (sortBy === 'rating') return b.rating - a.rating;
    if (sortBy === 'price_asc') return a.priceMonthlyStart - b.priceMonthlyStart;
    if (sortBy === 'distance_asc') return distanceFor(a) - distanceFor(b);
    return 0;
  });

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = locationInput.trim().toLowerCase();
    if (!q) {
      return allLocations.slice(0, 5).map((location) => ({ type: 'location', location }));
    }
    const locationMatches = allLocations
      .filter(
        (loc) =>
          loc.label.toLowerCase().includes(q) ||
          loc.city.toLowerCase().includes(q) ||
          loc.aliases?.some((alias) => alias.includes(q))
      )
      .slice(0, 5)
      .map((location) => ({ type: 'location' as const, location }));

    const kosMatches = kosList
      .filter(
        (kos) =>
          kos.name.toLowerCase().includes(q) ||
          kos.district.toLowerCase().includes(q) ||
          kos.city.toLowerCase().includes(q)
      )
      .slice(0, 4)
      .map((kos) => ({ type: 'kos' as const, kos }));

    return [...locationMatches, ...kosMatches];
  }, [locationInput, allLocations, kosList]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuggestionsOpen(false);

    const q = locationInput.trim();
    const exactLocation = allLocations.find(
      (loc) =>
        loc.label.toLowerCase() === q.toLowerCase() ||
        loc.aliases?.some((alias) => alias === q.toLowerCase())
    );

    if (exactLocation) {
      applyLocation(exactLocation);
      setSearchQuery('');
      setSearchParams({ loc: exactLocation.id }, { replace: true });
      return;
    }

    if (q) {
      setSearchQuery(q);
      setSearchParams({ q }, { replace: true });
    } else {
      setSearchQuery('');
    }
  };

  const nearbyCampuses = activeLocation
    ? CAMPUSES.map((campus) => ({
        campus,
        distance: haversineMeters(activeLocation.coordinates, campus.coordinates),
      }))
        .filter((item) => item.distance <= NEARBY_CAMPUS_METERS)
        .sort((a, b) => a.distance - b.distance)
    : [];

  const hasActiveFilters =
    !!activeLocation ||
    genderFilter !== 'all' ||
    !!searchQuery ||
    filterDiscountOnly ||
    filterSurveyOnly ||
    maxPrice < PRICE_MAX;

  const handleResetFilters = () => {
    applyLocation(null);
    setGenderFilter('all');
    setSearchQuery('');
    setFilterDiscountOnly(false);
    setFilterSurveyOnly(false);
    setMaxPrice(PRICE_MAX);
    setLocationInput('');
    setSearchParams({}, { replace: true });
  };

  const secondaryFilterCount =
    (filterDiscountOnly ? 1 : 0) + (filterSurveyOnly ? 1 : 0) + (maxPrice < PRICE_MAX ? 1 : 0);

  const sortOptions = [
    { id: 'rating', label: 'Rating Tertinggi' },
    { id: 'price_asc', label: 'Harga Terendah' },
    { id: 'distance_asc', label: activeLocation ? 'Terdekat dari Titik Lokasi' : 'Terdekat ke Kampus' },
  ] as const;
  const currentSortLabel = sortOptions.find((o) => o.id === sortBy)?.label ?? 'Urutkan';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - var(--header-height))' }}>
      {/* Sticky Filter Bar */}
      <div
        ref={filterBarRef}
        className="search-filter-bar"
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
        <div className="app-container" style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          {/* Row 1: Full-width location search */}
          <div
            style={{ position: 'relative' }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setSuggestionsOpen(false);
            }}
          >
            <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div className="kobo-searchfield" style={{ flex: 1, minWidth: 0 }}>
                <SearchIcon size={17} />
                <input
                  type="text"
                  value={locationInput}
                  onChange={(e) => {
                    setLocationInput(e.target.value);
                    setSuggestionsOpen(true);
                  }}
                  onFocus={() => setSuggestionsOpen(true)}
                  placeholder="Cari area, lokasi, atau nama kos..."
                  aria-label="Cari lokasi atau kos"
                />
                {locationInput && (
                  <button
                    type="button"
                    className="kobo-searchfield__clear"
                    onClick={() => {
                      setLocationInput('');
                      setSuggestionsOpen(true);
                    }}
                    aria-label="Bersihkan pencarian"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="kobo-icon-btn"
                onClick={handleUseMyLocation}
                aria-label="Gunakan lokasi saya"
                title="Gunakan lokasi saya"
              >
                <LocateFixed size={16} color={isLocating ? 'var(--text-subtle)' : undefined} />
              </button>
              <Button type="submit" variant="primary" style={{ flexShrink: 0, height: 'var(--control-height-lg)' }}>
                Cari
              </Button>
            </form>

            {searchQuery.trim() && !activeLocation && (
              <div style={{ marginTop: '0.5rem' }}>
                <span className="kobo-token">
                  {searchQuery}
                  <button
                    type="button"
                    aria-label="Hapus kata kunci"
                    onClick={() => {
                      setSearchQuery('');
                      setLocationInput('');
                      setSearchParams({}, { replace: true });
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              </div>
            )}

            {/* Autocomplete Dropdown */}
            {suggestionsOpen && suggestions.length > 0 && (
              <div
                className="animate-slide-up"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  right: 0,
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-xl)',
                  border: '1px solid var(--border-subtle)',
                  padding: '0.35rem 0',
                  zIndex: 'var(--z-dropdown)',
                }}
              >
                {suggestions.map((suggestion) =>
                  suggestion.type === 'location' ? (
                    <button
                      key={suggestion.location.id}
                      type="button"
                      onClick={() => {
                        applyLocation(suggestion.location);
                        setSearchQuery('');
                      }}
                      className="interactive-tap"
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.7rem',
                        padding: '0.6rem 1rem',
                        textAlign: 'left',
                      }}
                    >
                      <MapPin size={16} color="var(--primary)" style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-main)', display: 'block' }}>
                          {suggestion.location.label}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {suggestion.location.area === suggestion.location.label
                            ? suggestion.location.city
                            : `${suggestion.location.area}, ${suggestion.location.city}`}{' '}
                          · Jadikan titik acuan peta
                        </span>
                      </span>
                    </button>
                  ) : (
                    <button
                      key={suggestion.kos.id}
                      type="button"
                      onClick={() => {
                        setSuggestionsOpen(false);
                        navigate(`/kos/${suggestion.kos.id}`);
                      }}
                      className="interactive-tap"
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.7rem',
                        padding: '0.6rem 1rem',
                        textAlign: 'left',
                      }}
                    >
                      <Building2 size={16} color="var(--text-subtle)" style={{ flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="truncate-1" style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-main)', display: 'block' }}>
                          {suggestion.kos.name}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {suggestion.kos.district}, {suggestion.kos.city} · {formatJuta(suggestion.kos.priceMonthlyStart)}/bln
                        </span>
                      </span>
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          {/* Row 2: gender segmented (left) + Filter / Urutkan popovers (right) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <div className="kobo-segmented" role="group" aria-label="Tipe kos">
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
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setGenderFilter(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Popover
                label="Filter pencarian"
                trigger={(p) => (
                  <button
                    {...p}
                    type="button"
                    className={`kobo-control${secondaryFilterCount > 0 ? ' is-active' : ''}`}
                  >
                    <SlidersHorizontal size={15} />
                    Filter
                    {secondaryFilterCount > 0 && (
                      <span className="kobo-control__count">{secondaryFilterCount}</span>
                    )}
                    <ChevronDown size={14} />
                  </button>
                )}
              >
                {({ close }) => (
                  <>
                    <div className="kobo-popover__title">Filter Tambahan</div>
                    <button
                      type="button"
                      className="kobo-optionrow"
                      aria-pressed={filterDiscountOnly}
                      onClick={() => setFilterDiscountOnly(!filterDiscountOnly)}
                    >
                      <GraduationCap size={16} />
                      <span>Diskon KTM</span>
                    </button>
                    <button
                      type="button"
                      className="kobo-optionrow"
                      aria-pressed={filterSurveyOnly}
                      onClick={() => setFilterSurveyOnly(!filterSurveyOnly)}
                    >
                      <CalendarCheck size={16} />
                      <span>Bisa Survey Gratis</span>
                    </button>

                    <div style={{ padding: '0.75rem 0.25rem 0.25rem' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          marginBottom: '0.4rem',
                        }}
                      >
                        <label
                          htmlFor="search-price"
                          style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}
                        >
                          Maks. Sewa
                        </label>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
                          {formatJuta(maxPrice)}
                        </span>
                      </div>
                      <input
                        id="search-price"
                        type="range"
                        className="kobo-range"
                        min={PRICE_MIN}
                        max={PRICE_MAX}
                        step={PRICE_STEP}
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(Number(e.target.value))}
                        style={{ ['--fill' as string]: priceFillPercent(maxPrice) }}
                      />
                    </div>

                    <div className="kobo-popover__footer">
                      {hasActiveFilters && (
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}
                        >
                          Reset
                        </button>
                      )}
                      <Button type="button" variant="primary" size="sm" onClick={close}>
                        Selesai
                      </Button>
                    </div>
                  </>
                )}
              </Popover>

              <Popover
                label="Urutkan hasil"
                trigger={(p) => (
                  <button {...p} type="button" className="kobo-control">
                    {currentSortLabel}
                    <ChevronDown size={14} />
                  </button>
                )}
              >
                {({ close }) => (
                  <>
                    {sortOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="menuitemradio"
                        className="kobo-optionrow"
                        aria-checked={sortBy === opt.id}
                        onClick={() => {
                          setSortBy(opt.id);
                          close();
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </>
                )}
              </Popover>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="app-container" style={{ flex: 1, paddingBottom: '3rem', paddingTop: '1.25rem' }}>
        {/* Location reference strip */}
        {activeLocation && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              flexWrap: 'wrap',
              padding: '0.65rem 0.9rem',
              marginBottom: '1rem',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
              <MapPin size={15} color="var(--accent)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)' }}>
                {activeLocation.label}
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {activeLocation.area === activeLocation.label
                  ? activeLocation.city
                  : `${activeLocation.area}, ${activeLocation.city}`}
              </span>
            </div>
            {nearbyCampuses.length > 0 && (
              <>
                <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-subtle)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <GraduationCap size={15} color="var(--primary)" />
                  {nearbyCampuses.slice(0, 2).map((item) => (
                    <span key={item.campus.id} style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      <strong style={{ color: 'var(--text-main)', fontWeight: 600 }}>{item.campus.shortName}</strong>{' '}
                      {formatDistance(item.distance)}
                    </span>
                  ))}
                </div>
              </>
            )}
            <div style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-main)' }}>{sortedKos.length}</strong> kos dalam radius 5 km
            </div>
          </div>
        )}

        <div
          className="search-split-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '1.5rem',
            alignItems: 'start',
          }}
        >
          {/* Left Column: Compact listing cards */}
          <div
            className="search-feed-column"
            style={{
              display: mobileViewMode === 'map' ? 'none' : 'flex',
              flexDirection: 'column',
              gap: '1rem',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
              <div>
                <h1 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {activeLocation ? `Kos di Sekitar ${activeLocation.label}` : 'Kos Terverifikasi'}
                </h1>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Menampilkan <strong>{sortedKos.length}</strong> pilihan dari {kosList.length} kos terdaftar
                </p>
              </div>
            </div>

            <div className="search-cards-grid">
              {sortedKos.map((kos) => (
                <div
                  key={kos.id}
                  onMouseEnter={() => setHoveredKosId(kos.id)}
                  onMouseLeave={() => setHoveredKosId(null)}
                >
                  <ListingCard kos={kos} distance={activeLocation ? distanceFor(kos) : undefined} />
                </div>
              ))}
            </div>

            {sortedKos.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '3.5rem 1.5rem',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-card)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <MapPin size={36} color="var(--text-subtle)" style={{ margin: '0 auto 0.85rem' }} />
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Tidak ada kos yang cocok</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.35rem', maxWidth: '380px', margin: '0.35rem auto 1.25rem' }}>
                  Coba perluas titik lokasi, naikkan batas sewa, atau kurangi kriteria filter.
                </p>
                <Button variant="outline" size="sm" onClick={handleResetFilters}>
                  Reset Semua Filter
                </Button>
              </div>
            )}
          </div>

          {/* Right Column: Bounded sticky map */}
          <aside
            className="search-map-column"
            style={{
              display: mobileViewMode === 'list' ? 'none' : 'block',
              position: 'sticky',
              top: `calc(var(--header-height) + ${filterBarHeight}px + 1rem)`,
              // 3.5rem (vs the 1rem top offset) leaves a real ~2.5rem gap below
              // the map instead of the 1rem that let it run into the viewport edge.
              height: `min(calc(100vh - var(--header-height) - ${filterBarHeight}px - 3.5rem), 520px)`,
              minHeight: '400px',
              zIndex: 0,
              isolation: 'isolate',
            }}
          >
            <LeafletMap
              kosList={sortedKos}
              activeLocation={activeLocation}
              hoveredKosId={hoveredKosId}
              onHoverKos={setHoveredKosId}
            />
          </aside>
        </div>
      </div>

      {/* Floating Mobile Map/List Toggle */}
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
          onClick={() => {
            setMobileViewMode(mobileViewMode === 'list' ? 'map' : 'list');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
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
              <MapIcon size={18} />
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
        .search-cards-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
        }
        @media (min-width: 560px) {
          .search-cards-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        /* 3 across only from 1280px: at 1024px the 64% feed column is ~614px,
           which would squeeze each card under 200px. */
        @media (min-width: 1280px) {
          .search-cards-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (min-width: 1024px) {
          .search-split-grid {
            grid-template-columns: 64fr 36fr !important;
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
        @media (max-width: 640px) {
          .hide-on-mobile {
            display: none !important;
          }
        }
        @media (max-width: 1023px) {
          .search-filter-bar {
            position: static !important;
          }
          .search-map-column {
            position: static !important;
            height: calc(100vh - var(--header-height) - ${filterBarHeight}px - 1rem) !important;
            min-height: 360px;
          }
        }
      `}</style>
    </div>
  );
};
