import React from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { Button } from '../ui/Button';

export const OwnerCta: React.FC = () => (
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
);
