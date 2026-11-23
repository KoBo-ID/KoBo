import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Link, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Building2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/AppContext';
import { Button, ButtonLink } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { Avatar } from '../components/ui/Avatar';
import { AccountSecurityCard } from '../components/auth/AccountSecurityCard';
import { StudentVerificationCard } from '../components/profile/StudentVerificationCard';
import { EmergencyContactCard, RemindersAndTermsCard } from '../components/profile/ConsentCards';
import { useSession } from '../lib/session';
import { safeNext } from '../lib/safeNext';
import { useMyDiscountStatus } from '../components/booking/CampusDiscountCard';
import { BecomeOwnerModal } from '../components/owner/BecomeOwnerModal';
import { useTRPC } from '../lib/trpc';
import { CAMPUS_RETURN_MESSAGES, messageForError } from '../lib/errors';

/** "Kampus terverifikasi: X" with the Kampus Mitra status (the discount applies only to partner campuses). */
const MitraStatusLine: React.FC = () => {
  const status = useMyDiscountStatus();
  if (status.isPending) return <p role="status" style={{ fontSize: 'var(--step--2)', color: 'var(--text-muted)', marginTop: '0.4rem' }}>Memeriksa kampus…</p>;
  if (status.isError) return <p role="alert" style={{ fontSize: 'var(--step--2)', color: 'var(--text-muted)', marginTop: '0.4rem' }}>Gagal memeriksa kampus mitra. <button type="button" onClick={() => void status.refetch()} style={{ background: 'none', border: 0, padding: 0, color: 'var(--primary)', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Coba lagi</button></p>;
  if (!status.data.campusName) return null;
  return (
    <p style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--step--1)', color: 'var(--text-main)', marginTop: '0.4rem' }}>
      <span>Kampus terverifikasi: <strong>{status.data.campusName}</strong></span>
      {status.data.affiliated
        ? <span style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-badge)', fontSize: 'var(--step--2)', fontWeight: 700 }}>Kampus Mitra</span>
        : <span style={{ color: 'var(--text-muted)', fontSize: 'var(--step--2)' }}>bukan kampus mitra</span>}
    </p>
  );
};

export const Profile: React.FC = () => {
  useDocumentTitle('Profil');
  const { addToast, openAuthModal } = useAppStore();
  const { me, isLoading } = useSession();
  const [registering, setRegistering] = useState(false);
  const trpc = useTRPC();
  const qc = useQueryClient();
  const save = useMutation(trpc.auth.updateProfile.mutationOptions());

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [campus, setCampus] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The campus email link and the campus-account sign-in come back here as /profile?campus=<result>.
  const [params, setParams] = useSearchParams();
  const campusResult = params.get('campus');
  const [campusNotice, setCampusNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const signedIn = !!me;
  // Sent here from a kos to verify: once verified or waiting for review, offer the way back (open redirects refused by safeNext).
  const nextParam = params.get('next');
  const backToKos = nextParam && (me?.campusVerified || me?.studentVerification.state === 'PENDING') ? safeNext(nextParam, '') || null : null;
  useEffect(() => {
    if (!campusResult || !signedIn) return;
    const known = CAMPUS_RETURN_MESSAGES[campusResult];
    if (known) {
      setCampusNotice(known);
      if (known.tone === 'success') {
        addToast(known.text, 'success');
        void qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.campus.myDiscountStatus.queryKey() });
      }
    }
    const next = new URLSearchParams(params);
    next.delete('campus');
    setParams(next, { replace: true });
  }, [campusResult, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot on the ?campus= return; params/qc/addToast are read fresh and must not re-trigger it

  if (!me) {
    return (
      <div className="app-container" style={{ maxWidth: '960px', paddingTop: '3rem', paddingBottom: '4rem', textAlign: 'center' }}>
        {isLoading ? (
          <p role="status" style={{ color: 'var(--text-muted)' }}>Memuat profil…</p>
        ) : (
          <>
            <h1 style={{ fontSize: 'var(--step-2)', fontWeight: 800 }}>Masuk untuk Melihat Profil</h1>
            <p style={{ color: 'var(--text-muted)', margin: '0.5rem 0 1.25rem' }}>Profil dan verifikasi status mahasiswa tersimpan di akun Anda.</p>
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
        <h1 className="page-title">
          Profil Akun & Verifikasi Kampus
        </h1>
        <p style={{ fontSize: 'var(--step-0)', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Kelola informasi identitas dan verifikasi status mahasiswa Anda.
        </p>
        {backToKos && (
          <Link to={backToKos} data-testid="back-to-kos" style={{ display: 'inline-flex', alignItems: 'center', minHeight: '40px', marginTop: '0.75rem', fontWeight: 700, color: 'var(--primary)' }}>
            Kembali ke kos
          </Link>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
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
            <Avatar src={user.image} name={user.name} size={72} style={{ border: '3px solid var(--primary-light)' }} />
            <div>
              <h2 style={{ fontSize: 'var(--step-1)', fontWeight: 800, color: 'var(--text-main)' }}>
                {user.name}
              </h2>
              <p style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>
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
                    fontSize: 'var(--step--2)',
                    fontWeight: 700,
                    marginTop: '0.5rem',
                  }}
                >
                  <ShieldCheck size={14} />
                  <span>Mahasiswa Terverifikasi</span>
                </div>
              )}
              {me?.campusVerified && <MitraStatusLine />}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: 'var(--step--1)' }}>
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

        {campusNotice && <Notice tone={campusNotice.tone}>{campusNotice.text}</Notice>}
        {!me.isOwner && <StudentVerificationCard />}

        {me && !me.user.isDemo && (
          <section aria-labelledby="profile-consent-title">
            <h3 id="profile-consent-title" className="sr-only">Kontak darurat dan persetujuan</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <EmergencyContactCard />
              <RemindersAndTermsCard />
            </div>
          </section>
        )}

        {me && !me.user.isDemo && <AccountSecurityCard />}

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
              <Building2 size={18} color="var(--primary)" aria-hidden="true" />
              <h2 style={{ fontSize: 'var(--step-0)', fontWeight: 700 }}>Punya kos?</h2>
            </div>
            {me.isOwner ? (
              <>
                <p style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>Akun Anda sudah terdaftar sebagai pemilik.</p>
                <div>
                  <ButtonLink to="/owner/dashboard" variant="outline" size="sm">Buka Dasbor Pemilik</ButtonLink>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>Kelola kamar, tagihan, dan kuitansi dari dashboard pemilik. Gratis.</p>
                <div>
                  <Button variant="primary" size="sm" onClick={() => setRegistering(true)}>
                    Daftarkan diri sebagai pemilik
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        </div>

      </div>
      {registering && <BecomeOwnerModal onClose={() => setRegistering(false)} />}
    </div>
  );
};
