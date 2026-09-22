import React, { useState } from 'react';
import { User, GraduationCap, Phone, Mail, ShieldCheck, Heart, LogOut, CheckCircle2, Building2 } from 'lucide-react';
import { useAppStore } from '../store/AppContext';
import { ListingCard } from '../components/kos/ListingCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export const Profile: React.FC = () => {
  const { currentUser, updateUserProfile, kosList, setActivePersona, addToast } = useAppStore();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [phone, setPhone] = useState(currentUser.phone);
  const [campus, setCampus] = useState(currentUser.campus || 'Binus University (Syahdan)');

  const savedKosList = kosList.filter((k) => currentUser.savedKosIds.includes(k.id));

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateUserProfile({
      name,
      email,
      phone,
      campus,
    });
    setIsEditing(false);
  };

  return (
    <div className="app-container" style={{ maxWidth: '960px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
          Profil Akun & Verifikasi Kampus
        </h1>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Kelola informasi identitas dan status Kartu Tanda Mahasiswa (KTM) untuk klaim diskon sewa.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '2rem',
          alignItems: 'start',
        }}
        className="profile-split-layout"
      >
        {/* User Card */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            padding: '1.75rem',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
          }}
        >
          {/* Avatar & Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '3px solid var(--primary-light)',
              }}
            />
            <div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {currentUser.name}
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {currentUser.email}
              </p>

              {currentUser.ktmVerified && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    backgroundColor: 'var(--primary-light)',
                    color: 'var(--primary)',
                    padding: '0.2rem 0.6rem',
                    borderRadius: 'var(--radius-badge)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    marginTop: '0.5rem',
                  }}
                >
                  <ShieldCheck size={14} />
                  <span>KTM Mahasiswa Terverifikasi</span>
                </div>
              )}
            </div>
          </div>

          {/* Profile Form */}
          {isEditing ? (
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <Input
                label="Nama Lengkap"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                label="Alamat Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                label="Nomor WhatsApp"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              <Input
                label="Asal Kampus / Universitas"
                value={campus}
                onChange={(e) => setCampus(e.target.value)}
                required
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="primary" size="sm">
                  Simpan Perubahan
                </Button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.65rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Asal Kampus:</span>
                <span style={{ fontWeight: 600 }}>{currentUser.campus}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.65rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Nomor WhatsApp:</span>
                <span style={{ fontWeight: 600 }}>{currentUser.phone}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.65rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Peran Akun:</span>
                <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                  {currentUser.role === 'student' ? 'Pencari Kos / Mahasiswa' : 'Pemilik Kos'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  Ubah Profil
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setActivePersona(currentUser.role === 'student' ? 'owner' : 'student');
                  }}
                  icon={<Building2 size={15} />}
                >
                  Beralih ke {currentUser.role === 'student' ? 'Mode Pemilik Kos' : 'Mode Pencari Kos'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Favorite Kos Wishlist Section */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
            <Heart size={20} color="var(--status-overdue)" />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>
              Kos Favorit Saya ({savedKosList.length})
            </h3>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '1.25rem',
            }}
          >
            {savedKosList.map((kos) => (
              <ListingCard key={kos.id} kos={kos} />
            ))}
          </div>

          {savedKosList.length === 0 && (
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)',
                padding: '3rem 1rem',
                textAlign: 'center',
                color: 'var(--text-muted)',
              }}
            >
              Belum ada kos yang Anda simpan ke favorit.
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .profile-split-layout {
            grid-template-columns: 380px 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};
