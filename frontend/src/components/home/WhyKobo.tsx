import React from 'react';
import {
  GraduationCap,
  CheckCircle2,
  MessageSquare,
  MapPin,
  Wallet,
  ShieldCheck,
  CalendarCheck,
  UtensilsCrossed,
  ShoppingCart,
  Shirt,
} from 'lucide-react';

export const WhyKobo: React.FC = () => (
        <section className="app-container">
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
              Mengapa Memilih Kos Lewat KoBo?
            </h2>
          </div>
  
          {/* Asymmetric Editorial 3-Pillar Grid */}
          <div
            className="why-kobo-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '1rem',
              alignItems: 'stretch',
            }}
          >
            {/* ── Pillar A: Survey – WhatsApp Confirmation Mockup ── */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--border-subtle)',
                padding: '1.1rem',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.7rem',
              }}
            >
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '0.3rem' }}>
                  Survey Fisik Gratis
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
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
                    padding: '0.8rem',
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
                      padding: '0.5rem 0.7rem',
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
  
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="var(--primary)" />
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--primary)', textAlign: 'center', lineHeight: 1.35 }}>Terjadwal otomatis · Tanpa telepon</span>
              </div>
            </div>
  
            {/* ── Pillar B: KTM Discount – Interactive Price Preview ── */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--border-subtle)',
                padding: '1.1rem',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.7rem',
              }}
            >
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '0.3rem' }}>
                  Diskon Khusus Pelajar &amp; Mahasiswa
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
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
                    padding: '0.8rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.55rem',
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
                          fontSize: '1.3rem',
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
  
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="var(--accent)" />
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)', textAlign: 'center', lineHeight: 1.35 }}>Verifikasi sekali berlaku sepanjang masa studi</span>
              </div>
            </div>
  
            {/* ── Pillar C: Proximity – real walking distances ── */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--border-subtle)',
                padding: '1.1rem',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.7rem',
              }}
            >
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '0.3rem' }}>
                  Radar Sekitar Kos
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Ketahui jarak jalan kaki riil ke kampus, warteg, binatu, dan minimarket 24 jam sebelum kamu memutuskan.
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
                      padding: '0.38rem 0.6rem',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '20px',
                        height: '20px',
                        borderRadius: 'var(--radius-xs)',
                        backgroundColor: 'var(--bg-muted)',
                        flexShrink: 0,
                      }}
                    >
                      {poi.icon}
                    </span>
                    <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-main)', flex: 1 }}>
                      {poi.label}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <MapPin size={11} color={poi.color} />
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: poi.color }}>{poi.dist}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: 0 }} />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="var(--primary)" />
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--primary)', textAlign: 'center', lineHeight: 1.35 }}>Jarak jalan kaki terverifikasi</span>
              </div>
            </div>

            {/* ── Pillar D: Written fees, deposit and penalties ── */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--border-subtle)',
                padding: '1.1rem',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.7rem',
              }}
            >
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '0.3rem' }}>
                  Transparansi Denda &amp; Deposit
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Semua angka tertulis sejak awal: deposit yang dikembalikan, nominal denda, dan biaya layanan. Tanpa tagihan dadakan.
                </p>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.55rem' }}>
                {[
                  { label: 'Deposit (dikembalikan)', val: 'Rp 500.000' },
                  { label: 'Denda telat bayar', val: 'Rp 50.000' },
                  { label: 'Biaya layanan KoBo', val: 'Rp 25.000' },
                  { label: 'Aturan jam malam', val: 'Tertulis' },
                ].map((fee) => (
                  <div
                    key={fee.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.65rem',
                      backgroundColor: 'var(--bg-page)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.38rem 0.6rem',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-main)' }}>{fee.label}</span>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary)' }}>{fee.val}</span>
                  </div>
                ))}
              </div>

                {/* Zero Hidden Deposit Clause */}
                <div
                  style={{
                    backgroundColor: 'hsla(176, 55%, 94%, 0.7)',
                    border: '1px solid var(--primary-light)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.45rem 0.7rem',
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

              <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: 0 }} />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={14} color="var(--primary)" />
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--primary)', textAlign: 'center', lineHeight: 1.35 }}>Bebas sengketa biaya tersembunyi</span>
              </div>
            </div>
          </div>
  
          {/* Mobile fallback: switch to single column */}
          <style>{`
            @media (max-width: 1200px) {
              .why-kobo-grid {
                grid-template-columns: repeat(2, 1fr) !important;
              }
            }
            @media (max-width: 768px) {
              .why-kobo-grid {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>
        </section>
  );
