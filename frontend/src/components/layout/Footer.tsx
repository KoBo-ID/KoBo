import React from 'react';
import { Link } from 'react-router-dom';
import { PRESET_LOCATIONS } from '../../data/locations';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        paddingTop: '3.5rem',
        paddingBottom: '3rem',
        marginTop: '4rem',
      }}
    >
      <div className="app-container">
        {/* Footer Navigation Columns */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '2.5rem',
            marginBottom: '3rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '1rem' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--primary)',
                  color: 'white',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                K
              </div>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                Ko<span style={{ color: 'var(--primary)' }}>Bo</span>
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
              Kos Booking with KoBo
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Platform persewaan kos modern, bersih, dan bebas calo. Menghubungkan penyewa dengan pemilik kos secara transparan dan manusiawi.
            </p>
          </div>

          <div>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Lokasi Populer</h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {PRESET_LOCATIONS.map((loc) => (
                <li key={loc.id}>
                  <Link
                    to={`/search?loc=${loc.id}`}
                    style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}
                    className="interactive-tap"
                  >
                    Kos di {loc.label}, {loc.city}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Untuk Pencari Kos</h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <li>
                <Link to="/search" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Cari Kos Terdekat
                </Link>
              </li>
              <li>
                <Link to="/my-kos" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Jadwal Survey Saya
                </Link>
              </li>
              <li>
                <Link to="/profile" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Verifikasi Kartu Mahasiswa (KTM)
                </Link>
              </li>
              <li>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Bantuan Sewa: WhatsApp Support
                </span>
              </li>
            </ul>
          </div>

          <div>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Untuk Pemilik Kos</h4>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <li>
                <Link to="/owner/login" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Portal Masuk Pemilik Kos
                </Link>
              </li>
              <li>
                <Link to="/owner/kos" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Tambah &amp; Kelola Properti
                </Link>
              </li>
              <li>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Tagih Sewa WhatsApp Otomatis
                </span>
              </li>
              <li>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Download Kuitansi PDF Resmi
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div
          style={{
            paddingTop: '2rem',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            fontSize: '0.8rem',
            color: 'var(--text-subtle)',
          }}
        >
          <p>© 2026 KoBo Indonesia. Dibuat dengan penuh dedikasi untuk pencari kos &amp; Bapak/Ibu pemilik kos.</p>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <span>Syarat &amp; Ketentuan</span>
            <span>Kebijakan Privasi</span>
            <span>Standar Komunitas Kos</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
