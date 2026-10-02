import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Building2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/AppContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { CampusDiscountCard } from '../components/booking/CampusDiscountCard';
import { useSession } from '../lib/session';
import { useBecomeOwner } from '../lib/owner';
import { useTRPC } from '../lib/trpc';
import { messageForError } from '../lib/errors';

/** Headline student discount shown on the verification card (the per-kos amount applies at checkout). */
const DISCOUNT_UP_TO = 150000;

export const Profile: React.FC = () => {
  const { addToast, openAuthModal } = useAppStore();
  const { me, isLoading } = useSession();
  const { becomeOwner, isPending, error: ownerError } = useBecomeOwner();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const save = useMutation(trpc.auth.updateProfile.mutationOptions());

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [campus, setCampus] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!me) {
    return (
      <div className="app-container" style={{ maxWidth: '960px', paddingTop: '3rem', paddingBottom: '4rem', textAlign: 'center' }}>
        {isLoading ? (
          <p role="status" style={{ color: 'var(--text-muted)' }}>Memuat profil…</p>
        ) : (
          <>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Masuk untuk Melihat Profil</h1>
            <p style={{ color: 'var(--text-muted)', margin: '0.5rem 0 1.25rem' }}>Profil dan verifikasi email kampus tersimpan di akun Anda.</p>
            <Button variant="primary" onClick={openAuthModal}>Masuk</Button>
          </>
        )}
      </div>
    );
  }
  const user = me.user;

  const startEdit = () => {
    setName(user.name);
    setPhone(user.phone ?? '');
    setCampus(user.campus ?? '');
    setError(null);
    setIsEditing(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await save.mutateAsync({ name, phone: phone.trim() || null, campus: campus.trim() || null });
      await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      addToast('Profil berhasil diperbarui.', 'success');
      setIsEditing(false);
    } catch (err) {
      setError(messageForError(err));
    }
  };

  return (
    <div className="app-container" style={{ maxWidth: '960px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
          Profil Akun & Verifikasi Kampus
        </h1>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Kelola informasi identitas dan verifikasi email kampus (.ac.id) untuk klaim diskon sewa.
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
              src={user.image ?? ''}
              alt={user.name}
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
                {user.name}
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {user.email}
              </p>

              {me?.campusVerified && (
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
                  <span>Email Kampus Terverifikasi</span>
                </div>
              )}
            </div>
          </div>

          {/* Profile Form */}
          {isEditing ? (
            <form onSubmit={(e) => void handleSaveProfile(e)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <Input
                label="Nama Lengkap"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                label="Nomor WhatsApp"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <Input
                label="Asal Kampus / Universitas"
                value={campus}
                onChange={(e) => setCampus(e.target.value)}
              />
              {error && <Notice tone="error">{error}</Notice>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                  Batal
                </Button>
                <Button type="submit" variant="primary" size="sm" isLoading={save.isPending}>
                  Simpan Perubahan
                </Button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.65rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Asal Kampus:</span>
                <span style={{ fontWeight: 600 }}>{user.campus ?? '-'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.65rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Nomor WhatsApp:</span>
                <span style={{ fontWeight: 600 }}>{user.phone ?? '-'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.65rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Peran Akun:</span>
                <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                  {me.isOwner ? 'Pemilik Kos' : 'Pencari Kos / Mahasiswa'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <Button variant="outline" size="sm" onClick={startEdit}>
                  Ubah Profil
                </Button>
              </div>
            </div>
          )}
        </div>

        <CampusDiscountCard studentDiscountAmount={DISCOUNT_UP_TO} />

        {me && !me.user.isDemo && (
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={18} color="var(--primary)" />
              <h4 style={{ fontSize: '1rem', fontWeight: 700 }}>Punya kos?</h4>
            </div>
            {me.isOwner ? (
              <>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Akun Anda sudah terdaftar sebagai pemilik.</p>
                <Link to="/owner/dashboard">
                  <Button variant="outline" size="sm">Buka Dashboard Pemilik</Button>
                </Link>
              </>
            ) : (
              <>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Kelola kamar, tagihan, dan kuitansi dari dashboard pemilik. Gratis.</p>
                {ownerError && <Notice tone="error">{ownerError}</Notice>}
                <Button variant="primary" size="sm" isLoading={isPending} disabled={isPending} onClick={() => void becomeOwner()}>
                  Daftarkan diri sebagai pemilik
                </Button>
              </>
            )}
          </div>
        )}
        </div>

      </div>
    </div>
  );
};
