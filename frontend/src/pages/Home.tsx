import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Search,
  GraduationCap,
  Radar,
  Building2,
  ArrowRight,
  CheckCircle2,
  MessageSquare,
  MapPin,
  BadgeCheck,
  Wallet,
  ShieldCheck,
  CalendarCheck,
  LocateFixed,
  UtensilsCrossed,
  ShoppingCart,
  Shirt,
} from 'lucide-react';
import { useAppStore } from '../store/AppContext';
import { PRESET_LOCATIONS } from '../data/locations';
import { Kos } from '../types';
import { ListingCard } from '../components/kos/ListingCard';
import { Button } from '../components/ui/Button';
import { Pill } from '../components/ui/Pill';
import { VisitModal } from '../components/booking/VisitModal';

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const { kosList } = useAppStore();

  const [searchInput, setSearchInput] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedVisitKos, setSelectedVisitKos] = useState<Kos | null>(null);

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

  const featuredKos = kosList.slice(0, 4);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--section-gap)' }}>
      {/* ─── Hero Section ─── */}
      <section
        style={{
          background: 'radial-gradient(110% 110% at 50% 0%, hsla(176, 55%, 94%, 0.85) 0%, var(--bg-page) 100%)',
          paddingTop: '4.5rem',
          paddingBottom: '3.5rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="app-container" style={{ textAlign: 'center', maxWidth: '780px' }}>
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

          {/* Trust Pill */}
          <div style={{ marginBottom: '1.1rem' }}>
            <Pill tone="primary" icon={<ShieldCheck size={14} />}>
              Platform Kos Terverifikasi
            </Pill>
          </div>

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
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            Tentukan titik lokasimu, lihat kos dan kampus terdekat di peta, lalu sewa dengan aturan yang tertulis jelas. Untuk mahasiswa maupun pekerja.
          </p>

          {/* ── Location Search Bar ── */}
          <div
            style={{ position: 'relative', maxWidth: '660px', margin: '0 auto' }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setSuggestionsOpen(false);
            }}
          >
            <form
              id="hero-search-form"
              onSubmit={handleSearchSubmit}
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: '9999px',
                padding: '0.4rem 0.4rem 0.4rem 1.4rem',
                boxShadow: 'var(--shadow-lg)',
                gap: '0.4rem',
                border: 'none',
              }}
            >
              <Search size={18} color="var(--primary)" style={{ flexShrink: 0 }} />
              <input
                id="hero-search-input"
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onFocus={() => setSuggestionsOpen(true)}
                placeholder="Cari area, lokasi, atau nama kos..."
                style={{
                  width: '100%',
                  minWidth: 0,
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.95rem',
                  fontFamily: 'var(--font-sans)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-main)',
                }}
              />
              <button
                type="button"
                onClick={handleUseMyLocation}
                className="interactive-tap hide-on-mobile"
                title="Gunakan lokasi saya"
                aria-label="Gunakan lokasi saya"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '9999px',
                  color: 'var(--primary)',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  backgroundColor: 'var(--primary-light)',
                  flexShrink: 0,
                }}
              >
                <LocateFixed size={15} />
                <span>Lokasi Saya</span>
              </button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                style={{ borderRadius: '9999px', flexShrink: 0 }}
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

        {/* Scoped focus-within glow (Issue 5) */}
        <style>{`
          #hero-search-form:focus-within {
            box-shadow: 0 12px 32px -4px hsla(176, 75%, 28%, 0.18), 0 4px 12px -2px hsla(176, 75%, 28%, 0.10);
            outline: none;
          }
          #hero-search-input:focus {
            outline: none;
            box-shadow: none;
          }
          #hero-search-form:focus-within #hero-search-input {
            outline: none;
          }
        `}</style>
      </section>

      {/* ─── Editorial "Why Choose KoBo" (Issue 6) ─── */}
      <section className="app-container">
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 800,
              color: 'var(--accent)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Standar Pengalaman Sewa
          </span>
          <h2 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '0.35rem' }}>
            Mengapa Memilih Kos Lewat KoBo?
          </h2>
          <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: '0.4rem', maxWidth: '560px', margin: '0.4rem auto 0' }}>
            Kami menghilangkan kekhawatiran klasik penyewa kos: foto palsu, denda sepihak, dan biaya tersembunyi.
          </p>
        </div>

        {/* Asymmetric Editorial 3-Pillar Grid */}
        <div
          className="why-kobo-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '1.5rem',
            alignItems: 'stretch',
          }}
        >
          {/* ── Pillar A: Survey – WhatsApp Confirmation Mockup ── */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-xl)',
              border: '1px solid var(--border-subtle)',
              padding: '2rem',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div>
              <div style={{ marginBottom: '0.85rem' }}>
                <Pill size="sm" tone="primary" icon={<BadgeCheck size={12} />}>
                  Otomatis via WhatsApp
                </Pill>
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.4rem' }}>
                Survey Fisik Gratis
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
                Pilih slot survey pagi atau sore langsung dengan pemilik kos. Cek kebersihan kamar, kekuatan WiFi, dan suasana lingkungan sebelum transaksi apa pun.
              </p>
            </div>

            {/* Middle: WhatsApp Survey Invite Mockup */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div
                style={{
                  backgroundColor: 'hsl(120, 28%, 97%)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid hsl(120, 20%, 88%)',
                  padding: '1rem',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      backgroundColor: 'hsl(142, 60%, 40%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <MessageSquare size={14} color="white" />
                  </div>
                  <span style={{ fontWeight: 700, color: 'hsl(142, 60%, 28%)' }}>KoBo Survey Bot</span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: '0.68rem',
                      backgroundColor: 'hsl(142, 60%, 40%)',
                      color: 'white',
                      padding: '0.1rem 0.4rem',
                      borderRadius: '4px',
                      fontWeight: 700,
                    }}
                  >
                    OFFICIAL
                  </span>
                </div>
                <div
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '0 8px 8px 8px',
                    padding: '0.65rem 0.85rem',
                    lineHeight: 1.55,
                    color: 'var(--text-main)',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                  }}
                >
                  <p style={{ marginBottom: '0.3rem', color: 'var(--text-main)' }}>
                    Halo <strong>Bima</strong>, survey kamar kos di
                  </p>
                  <p style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: '0.4rem' }}>
                    Kos Menteng Syahdan
                  </p>
                  <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.72rem', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 600 }}>
                      <CalendarCheck size={11} /> Kamis, 25 Sep
                    </span>
                    <span style={{ fontSize: '0.72rem', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 600 }}>
                      10:00 WIB
                    </span>
                  </div>
                  <p style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <CheckCircle2 size={12} color="var(--primary)" /> Dikonfirmasi oleh pemilik kos
                  </p>
                </div>
              </div>
            </div>

            <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: 0 }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CheckCircle2 size={14} color="var(--primary)" />
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--primary)' }}>Terjadwal otomatis · Tanpa telepon</span>
            </div>
          </div>

          {/* ── Pillar B: KTM Discount – Interactive Price Preview ── */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-xl)',
              border: '1px solid var(--border-subtle)',
              padding: '2rem',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div>
              <div style={{ marginBottom: '0.85rem' }}>
                <Pill size="sm" tone="accent" icon={<GraduationCap size={12} />}>
                  Verifikasi KTM
                </Pill>
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.4rem' }}>
                Diskon Khusus Pelajar &amp; Mahasiswa
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
                Verifikasi KTM satu kali. Dapatkan potongan sewa bulanan hingga Rp 150.000/bulan langsung — tanpa kuota, tanpa kode promo.
              </p>
            </div>

            {/* Middle: KTM Price Reduction Mockup */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div
                style={{
                  backgroundColor: 'var(--primary-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--primary-light)',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                {/* KTM Verified Badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div
                    style={{
                      backgroundColor: 'var(--primary)',
                      color: 'white',
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      padding: '0.2rem 0.55rem',
                      borderRadius: '4px',
                      letterSpacing: '0.03em',
                    }}
                  >
                    KTM VERIFIED
                  </div>
                  <CheckCircle2 size={15} color="var(--primary)" />
                  <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>Bima Sakti — Binus</span>
                </div>

                {/* Price Strike-through */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.1rem' }}>
                    <span
                      style={{
                        fontSize: '1rem',
                        color: 'var(--text-subtle)',
                        textDecoration: 'line-through',
                        fontWeight: 600,
                      }}
                    >
                      Rp 1.650.000
                    </span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        backgroundColor: 'hsla(0,90%,55%,0.12)',
                        color: 'hsl(0, 72%, 50%)',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '4px',
                        fontWeight: 700,
                      }}
                    >
                      Harga Normal
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                    <span
                      style={{
                        fontSize: '1.65rem',
                        color: 'var(--primary)',
                        fontWeight: 800,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      Rp 1.500.000
                    </span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        backgroundColor: 'var(--primary-light)',
                        color: 'var(--primary)',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '4px',
                        fontWeight: 800,
                      }}
                    >
                      Harga KTM
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    backgroundColor: 'var(--primary-light)',
                    padding: '0.45rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <Wallet size={13} color="var(--primary)" />
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)' }}>
                    Hemat Rp 150.000 / bulan · Otomatis terpotong
                  </span>
                </div>
              </div>
            </div>

            <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: 0 }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CheckCircle2 size={14} color="var(--accent)" />
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)' }}>Verifikasi sekali berlaku sepanjang masa studi</span>
            </div>
          </div>

          {/* ── Pillar C: Radar & Transparency – POI Walking Distance ── */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-xl)',
              border: '1px solid var(--border-subtle)',
              padding: '2rem',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div>
              <div style={{ marginBottom: '0.85rem' }}>
                <Pill size="sm" tone="primary" icon={<Radar size={12} />}>
                  Radar Sekitar
                </Pill>
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.4rem' }}>
                Radar &amp; Transparansi Denda
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
                Ketahui jarak jalan kaki riil ke warteg, binatu, minimarket 24 jam. Klausul deposit dan aturan jam malam tertulis gamblang sejak awal.
              </p>
            </div>

            {/* Middle: POI Walking Distance Indicator */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.55rem' }}>
              {[
                { icon: <GraduationCap size={14} color="var(--primary)" />, label: 'Binus Syahdan', dist: '300m', color: 'var(--primary)' },
                { icon: <UtensilsCrossed size={14} color="hsl(28, 80%, 45%)" />, label: 'Warteg Bu Ida', dist: '80m', color: 'hsl(28, 80%, 45%)' },
                { icon: <ShoppingCart size={14} color="hsl(210, 80%, 48%)" />, label: 'Indomaret 24 Jam', dist: '50m', color: 'hsl(210, 80%, 48%)' },
                { icon: <Shirt size={14} color="hsl(270, 60%, 48%)" />, label: 'Laundry Kiloan', dist: '120m', color: 'hsl(270, 60%, 48%)' },
              ].map((poi) => (
                <div
                  key={poi.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    backgroundColor: 'var(--bg-page)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.5rem 0.65rem',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      borderRadius: 'var(--radius-xs)',
                      backgroundColor: 'var(--bg-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {poi.icon}
                  </span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', flex: 1 }}>
                    {poi.label}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <MapPin size={11} color={poi.color} />
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: poi.color }}>{poi.dist}</span>
                  </div>
                </div>
              ))}

              {/* Zero Hidden Deposit Clause */}
              <div
                style={{
                  backgroundColor: 'hsla(176, 55%, 94%, 0.7)',
                  border: '1px solid var(--primary-light)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.6rem 0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <ShieldCheck size={14} color="var(--primary)" />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)' }}>
                  Klausul deposit tertulis · Nol biaya tersembunyi
                </span>
              </div>
            </div>

            <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: 0 }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CheckCircle2 size={14} color="var(--primary)" />
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--primary)' }}>Bebas sengketa biaya tersembunyi</span>
            </div>
          </div>
        </div>

        {/* Mobile fallback: switch to single column */}
        <style>{`
          @media (max-width: 768px) {
            .why-kobo-grid {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </section>

      {/* ─── Featured Kos Recommendations ─── */}
      <section className="app-container">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '2rem' }}>
          <div>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Pilihan Terverifikasi
            </span>
            <h2 style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '0.2rem' }}>
              Rekomendasi Kos Terpopuler
            </h2>
          </div>
          <Link to="/search">
            <Button variant="outline" size="sm" icon={<ArrowRight size={16} />} iconPosition="right">
              Lihat Semua ({kosList.length})
            </Button>
          </Link>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '1.25rem',
          }}
        >
          {featuredKos.map((kos) => (
            <ListingCard
              key={kos.id}
              kos={kos}
              onOpenSurvey={(targetKos: Kos) => setSelectedVisitKos(targetKos)}
            />
          ))}
        </div>
      </section>

      {/* ─── Owner CTA Banner (Issue 7: redirect to /owner/login) ─── */}
      <section className="app-container">
        <div
          style={{
            background: 'linear-gradient(135deg, hsl(176, 75%, 26%) 0%, hsl(176, 80%, 18%) 100%)',
            borderRadius: 'var(--radius-card)',
            padding: '3rem 2.5rem',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '2rem',
          }}
        >
          <div style={{ maxWidth: '600px' }}>
            <span
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                color: 'white',
                padding: '0.25rem 0.65rem',
                borderRadius: 'var(--radius-xs)',
                fontSize: '0.72rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'inline-block',
                marginBottom: '1rem',
              }}
            >
              Khusus Pemilik Kos Terverifikasi
            </span>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, color: 'white', lineHeight: 1.25, marginBottom: '0.75rem' }}>
              Kelola Kos Lebih Rapi &amp; Santun, Dapatkan Penyewa Berkualitas
            </h2>
            <p style={{ fontSize: '0.95rem', color: 'rgba(255, 255, 255, 0.9)', lineHeight: 1.6 }}>
              Gunakan Papan Okupansi Kamar 5 status, kirim pengingat tagihan WhatsApp otomatis tanpa rasa canggung, dan cetak kuitansi resmi digital dalam 1 klik.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Link to="/owner/login" style={{ textDecoration: 'none' }}>
              <Button
                variant="accent"
                size="lg"
                icon={<Building2 size={18} />}
              >
                Portal Masuk Pemilik Kos
              </Button>
            </Link>
            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.75)', textAlign: 'center' }}>
              Akses terbatas untuk pemilik properti terverifikasi
            </span>
          </div>
        </div>
      </section>

      {/* Free Visit Modal */}
      {selectedVisitKos && (
        <VisitModal
          isOpen={!!selectedVisitKos}
          onClose={() => setSelectedVisitKos(null)}
          kos={selectedVisitKos}
        />
      )}
    </div>
  );
};
