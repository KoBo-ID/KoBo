import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  MapPin,
  GraduationCap,
  BedDouble,
  X,
  Map as MapIcon,
  List,
  LocateFixed,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
import { useAppStore } from '../store/AppContext';
import { CAMPUSES } from '../data/campuses';
import { branchById, groupOfBranch } from '@kobo/shared/campuses';
import { PRESET_LOCATIONS } from '../data/locations';
import { useTRPC } from '../lib/trpc';
import { kosCardToKos } from '../utils/kosCard';
import {
  PRICE_MAX,
  PRICE_MIN,
  PRICE_STEP,
  SEARCH_RADIUS_METERS,
  parseSearchParams,
  serializeSearchParams,
  type GenderFilter,
  type SearchFilters,
  type SortKey,
} from '@kobo/shared/search';
import type { KosSearchInput } from '@kobo/shared/schemas';
import { ListingCard } from '../components/kos/ListingCard';
import { VisitModal } from '../components/booking/VisitModal';
import { KosCardSkeleton } from '../components/kos/KosCardSkeleton';
import { CampusSearchField } from '../components/search/CampusSearchField';
import { ErrorState } from '../components/ui/QueryState';
import { LeafletMap } from '../components/kos/LeafletMap';
import { Button } from '../components/ui/Button';
import { Popover } from '../components/ui/Popover';
import { useResizeObserver } from '../hooks/useResizeObserver';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Kos, LocationPin } from '../types';
import { averageLatLng, formatDistance, haversineMeters } from '../utils/geo';

const NEARBY_CAMPUS_METERS = 3000;

const formatJuta = (value: number) => {
  const juta = value / 1000000;
  const formatted = Number.isInteger(juta) ? `${juta}` : juta.toFixed(1).replace('.', ',');
  return `Rp ${formatted}jt`;
};

const priceFillPercent = (value: number) =>
  `${((value - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100}%`;

/** Strips the administrative prefix: "Kota Tangerang Selatan" -> "tangerang selatan". */
const bareRegionName = (name: string) =>
  name.toLowerCase().replace(/./g, ' ').replace(/^(provinsi|kota administrasi|kabupaten administrasi|kota adm|kabupaten|kab|kota)s+/, '').replace(/s+/g, ' ').trim();

/** The province or regency/city a free-text search names exactly; null when it is only similar. Province first, then kota over kabupaten. */
export function pickRegion<T extends { code: string; level: number; kind: string; name: string }>(q: string, hits: T[]): T | null {
  const want = bareRegionName(q);
  const exact = hits.filter((h) => h.level <= 2 && (bareRegionName(h.name) === want || h.name.toLowerCase() === q.trim().toLowerCase()));
  exact.sort((a, b) => a.level - b.level || Number(b.kind === 'kota') - Number(a.kind === 'kota'));
  return exact[0] ?? null;
}

export const Search: React.FC = () => {
  const trpc = useTRPC();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hoveredKosId, setHoveredKosId } = useAppStore();

  const [mobileViewMode, setMobileViewMode] = useState<'list' | 'map'>('list');
  // What the user has typed into the search field; null means "show the active location's label".
  const [typedInput, setTypedInput] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [priceDraft, setPriceDraft] = useState<number | null>(null);
  const priceTimer = useRef<number | undefined>(undefined);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const filterBarDimensions = useResizeObserver(filterBarRef);
  const filterBarHeight = Math.max(filterBarDimensions.height, 112);

  // The URL is the single source of truth for every filter (spec section 10).
  const filters = useMemo(() => parseSearchParams(searchParams), [searchParams]);
  const updateFilters = (patch: Partial<SearchFilters>) =>
    setSearchParams((prev) => serializeSearchParams({ ...parseSearchParams(prev), ...patch }), { replace: true });

  useEffect(() => {
    if (filters.campus && !searchParams.has('sort')) updateFilters({ sort: 'distance_asc' });
    // The URL is the authority; this only fills the campus-specific missing default once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.campus, searchParams]);

  useEffect(() => () => window.clearTimeout(priceTimer.current), []);

  const searchQuery = filters.q;
  const genderFilter = filters.gender;
  const sortBy = filters.sort;
  const filterDiscountOnly = filters.discountOnly;
  const filterSurveyOnly = filters.surveyOnly;
  const maxPrice = priceDraft ?? filters.maxPrice;
  const setGenderFilter = (gender: GenderFilter) => updateFilters({ gender });
  const setSortBy = (sort: SortKey) => updateFilters({ sort });
  const setFilterDiscountOnly = (discountOnly: boolean) => updateFilters({ discountOnly });
  const setFilterSurveyOnly = (surveyOnly: boolean) => updateFilters({ surveyOnly });
  // The slider moves continuously; commit to the URL (and so to the server) once it settles.
  const setMaxPrice = (value: number) => {
    setPriceDraft(value);
    window.clearTimeout(priceTimer.current);
    priceTimer.current = window.setTimeout(() => {
      updateFilters({ maxPrice: value });
      setPriceDraft(null);
    }, 250);
  };

  // All kos (the cached kos.list the home page also uses): autocomplete, kos-derived areas, and the total count.
  const universe = useQuery(trpc.kos.list.queryOptions());
  const kosList = useMemo(() => (universe.data ?? []).map(kosCardToKos), [universe.data]);

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

  // The reference point is derived from the URL: a geolocation pair, or a preset / kos-area id.
  const activeLocation = useMemo<LocationPin | null>(() => {
    if (filters.lat !== null && filters.lng !== null) {
      const named = filters.place;
      return {
        id: named ? 'geo-place' : 'geo-me',
        label: named ?? 'Lokasi Saya',
        area: named ?? 'Sekitar Anda',
        city: `Radius ${Math.round((filters.radius ?? SEARCH_RADIUS_METERS) / 1000)} km`,
        coordinates: { lat: filters.lat, lng: filters.lng },
        source: 'geolocation',
        ...(filters.radius ? { radiusMeters: filters.radius } : {}),
      };
    }
    if (filters.campus) {
      const branch = branchById(filters.campus)
      const group = groupOfBranch(filters.campus)
      if (branch && group) return {
        id: `campus-${branch.id}`,
        label: group.branches.length === 1 ? group.shortName : `${group.shortName} ${branch.label}`,
        area: branch.label,
        city: branch.city,
        coordinates: { lat: branch.lat, lng: branch.lng },
        source: 'preset',
      }
    }
    return filters.loc ? (allLocations.find((loc) => loc.id === filters.loc) ?? null) : null;
  }, [filters.lat, filters.lng, filters.place, filters.radius, filters.campus, filters.loc, allLocations]);

  useDocumentTitle(filters.campus && activeLocation?.id.startsWith('campus-') ? `Kos dekat ${activeLocation.label}` : 'Cari kos');

  // What the user typed wins; otherwise the active place, otherwise the text being searched (e.g. arriving from the home page).
  // A province, regency or city (`?region=36`) is searched inside its boundary: no point, no radius.
  const regionOutline = useQuery({
    ...trpc.region.outline.queryOptions({ code: filters.region ?? '00' }),
    enabled: !!filters.region,
    staleTime: Infinity,
    retry: false,
  });
  const regionName = filters.region ? (regionOutline.data?.name ?? null) : null;
  const locationInput = typedInput ?? (activeLocation ? activeLocation.label : regionName ?? filters.q);
  const setLocationInput = (value: string) => setTypedInput(value);
  const clearLocationInput = () => {
    setTypedInput('');
    updateFilters({ q: '', loc: null, campus: null, lat: null, lng: null, place: null, radius: null, region: null });
  };

  // A kos-area id (area-*) can only be resolved once kos.list has loaded; do not search unfiltered meanwhile.
  const locationPending = !!filters.loc && !activeLocation && universe.isPending;

  // Free text ("banten") is looked up on the map once, when it arrives in the URL (a submit, never as-you-type). A
  // hit becomes the reference point; a miss or an outage falls back to matching the text against kos addresses.
  // The text is first matched against province / regency / city names (exact name only); only a miss goes to the geocoder.
  const resolveText = filters.q.length >= 2 && filters.lat === null && !filters.loc && !filters.campus && !filters.region;
  const regionQuery = useQuery({
    ...trpc.region.search.queryOptions({ q: filters.q, limit: 8 }),
    enabled: resolveText,
    staleTime: Infinity,
    retry: false,
  });
  const regionHit = useMemo(() => {
    if (!resolveText || !regionQuery.data) return null;
    return pickRegion(filters.q, regionQuery.data);
  }, [resolveText, regionQuery.data, filters.q]);
  useEffect(() => {
    if (!regionHit) return;
    setTypedInput((current) => current ?? filters.q);
    updateFilters({ q: '', loc: null, campus: null, lat: null, lng: null, place: null, radius: null, region: regionHit.code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionHit]);
  const regionResolving = resolveText && (regionQuery.isPending || !!regionHit);
  const resolvePlace = resolveText && !regionResolving;
  const placeQuery = useQuery({
    ...trpc.place.search.queryOptions({ q: filters.q }),
    enabled: resolvePlace,
    staleTime: Infinity,
    retry: false,
  });
  const placeResolving = resolvePlace && placeQuery.isPending;
  const place = placeQuery.data;
  useEffect(() => {
    if (!resolvePlace || !place) return;
    setTypedInput((current) => current ?? filters.q);
    updateFilters({ q: '', loc: null, campus: null, lat: place.lat, lng: place.lng, place: place.label, radius: place.radiusMeters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvePlace, place]);
  const placeNotice = !resolvePlace
    ? null
    : placeQuery.isError
      ? 'Pencarian lokasi sedang tidak tersedia, jadi kata ini dicari di alamat kos.'
      : place === null
        ? `Lokasi "${filters.q}" tidak ditemukan di peta, jadi kata ini dicari di alamat kos.`
        : null;
  const searchInput = useMemo<KosSearchInput>(
    () => ({
      q: filters.q,
      ...(filters.region ? { regionCode: filters.region } : {}),
      ...(activeLocation
        ? { lat: activeLocation.coordinates.lat, lng: activeLocation.coordinates.lng, ...(filters.radius ? { radius: filters.radius } : {}) }
        : {}),
      gender: filters.gender,
      maxPrice: filters.maxPrice,
      discountOnly: filters.discountOnly,
      surveyOnly: filters.surveyOnly,
      sort: filters.sort,
    }),
    [filters, activeLocation],
  );
  // The card's "Survey" button opens the visit modal in place, as on Home (no navigation).
  const [visitKos, setVisitKos] = useState<Kos | null>(null);
  const search = useQuery({
    ...trpc.kos.search.queryOptions(searchInput),
    placeholderData: keepPreviousData,
    enabled: !locationPending && !placeResolving && !regionResolving,
  });
  const searchPending = search.isPending;
  const searchFailed = search.isError && !search.data;

  // The list and the map render this same array.
  const sortedKos = useMemo(() => (search.data ?? []).map(kosCardToKos), [search.data]);
  const distanceById = useMemo(
    () => new Map((search.data ?? []).map((card) => [card.id, card.distanceMeters])),
    [search.data],
  );

  const applyLocation = (location: LocationPin | null, clearQuery = false) => {
    setTypedInput(null);
    const geo = location?.source === 'geolocation';
    updateFilters({
      loc: location && !geo ? location.id : null,
      campus: null,
      lat: location && geo ? location.coordinates.lat : null,
      lng: location && geo ? location.coordinates.lng : null,
      place: null,
      radius: null,
      region: null,
      ...(clearQuery ? { q: '' } : {}),
    });
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
        applyLocation({
          id: 'geo-me',
          label: 'Lokasi Saya',
          area: 'Sekitar Anda',
          city: 'Radius 5 km',
          coordinates: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          source: 'geolocation',
        });
      },
      () => {
        setIsLocating(false);
        applyLocation(null);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const q = locationInput.trim();
    // Only a full, exact place name becomes the map's reference point. Anything else is searched as typed, so
    // the box never rewrites what the user wrote into a different place (no alias or fuzzy matching).
    const exactLocation = allLocations.find((loc) => loc.label.toLowerCase() === q.toLowerCase());

    if (exactLocation) {
      applyLocation(exactLocation, true);
      return;
    }

    // A text search replaces the reference point, so the URL says exactly what is applied.
    updateFilters({ q, loc: null, campus: null, lat: null, lng: null, place: null, radius: null, region: null });
  };

  const handlePickCampus = (campusId: string) => {
    setTypedInput(null);
    updateFilters({
      q: '', loc: null, campus: campusId, lat: null, lng: null, place: null, radius: null, region: null,
      sort: searchParams.has('sort') ? filters.sort : 'distance_asc',
    });
  };

  const handleSearchText = (text: string) => {
    const q = text.trim();
    const exactLocation = allLocations.find((loc) => loc.label.toLowerCase() === q.toLowerCase());
    if (exactLocation) { applyLocation(exactLocation, true); return; }
    updateFilters({ q, loc: null, campus: null, lat: null, lng: null, place: null, radius: null, region: null });
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
    !!filters.region ||
    genderFilter !== 'all' ||
    !!searchQuery ||
    filterDiscountOnly ||
    filterSurveyOnly ||
    maxPrice < PRICE_MAX;

  const handleResetFilters = () => {
    window.clearTimeout(priceTimer.current);
    setPriceDraft(null);
    setTypedInput(null);
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - var(--header-height))', ['--filter-bar-height' as string]: `${filterBarHeight}px` }}>
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
          <div style={{ position: 'relative' }}>
            <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CampusSearchField
                value={locationInput}
                label="Cari lokasi"
                placeholder="Cari area atau lokasi..."
                onChange={setLocationInput}
                onClear={clearLocationInput}
                onSubmitText={handleSearchText}
                onPickCampus={(branch) => handlePickCampus(branch.id)}
                onPickRegion={(region) => { setTypedInput(null); updateFilters({ q: '', loc: null, campus: null, lat: null, lng: null, place: null, radius: null, region: region.code }); }}
                onPickPoint={(p) => { setTypedInput(null); updateFilters({ q: '', loc: null, campus: null, lat: p.lat, lng: p.lng, place: p.label, radius: 3000, region: null, sort: searchParams.has('sort') ? filters.sort : 'distance_asc' }); }}
                style={{ flex: 1, minWidth: 0 }}
              />
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

            {searchQuery.trim() && (
              <div style={{ marginTop: '0.5rem' }}>
                <span className="kobo-token">
                  {searchQuery}
                  <button
                    type="button"
                    aria-label="Hapus kata kunci"
                    onClick={() => {
                      setLocationInput('');
                      updateFilters({ q: '' });
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              </div>
            )}

            {placeNotice && (
              <p role="status" style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {placeNotice}
              </p>
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
            <div className="kobo-segmented kobo-segmented--wrap" role="group" aria-label="Tipe kos">
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
                      <span>Diskon Mahasiswa</span>
                    </button>
                    {/* URL/API name stays "surveyOnly"; it filters kos that have a bookable room. */}
                    <button
                      type="button"
                      className="kobo-optionrow"
                      aria-pressed={filterSurveyOnly}
                      onClick={() => setFilterSurveyOnly(!filterSurveyOnly)}
                    >
                      <BedDouble size={16} />
                      <span>Kamar tersedia</span>
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
        {filters.region && !activeLocation && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.65rem 0.9rem',
              marginBottom: '1rem',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <MapPin size={15} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)' }}>{regionName ?? 'Wilayah'}</span>
            <div style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text-main)' }}>{sortedKos.length}</strong> kos di {regionName ?? 'wilayah ini'}
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
                  {activeLocation ? `Kos di Sekitar ${activeLocation.label}` : 'Semua Kos'}
                </h1>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  {searchFailed ? null : searchPending ? (
                    'Memuat daftar kos…'
                  ) : (
                    <>
                      Menampilkan <strong>{sortedKos.length}</strong> pilihan dari {universe.data ? kosList.length : sortedKos.length} kos terdaftar
                    </>
                  )}
                </p>
              </div>
            </div>

            {searchFailed && (
              <ErrorState
                message="Gagal memuat daftar kos. Periksa koneksi Anda lalu coba lagi."
                onRetry={() => void search.refetch()}
              />
            )}

            <div className="search-cards-grid" aria-busy={searchPending} style={searchFailed ? { display: 'none' } : undefined}>
              {searchPending && [0, 1, 2, 3, 4, 5].map((i) => <KosCardSkeleton key={i} />)}
              {sortedKos.map((kos) => (
                <div
                  key={kos.id}
                  onMouseEnter={() => setHoveredKosId(kos.id)}
                  onMouseLeave={() => setHoveredKosId(null)}
                >
                  <ListingCard kos={kos} onOpenSurvey={setVisitKos} distance={activeLocation ? (distanceById.get(kos.id) ?? undefined) : undefined} />
                </div>
              ))}
            </div>

            {!searchPending && !searchFailed && sortedKos.length === 0 && (
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
              regionOutline={regionOutline.data ?? null}
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
      {visitKos && <VisitModal isOpen onClose={() => setVisitKos(null)} kos={visitKos} />}
    </div>
  );
};
