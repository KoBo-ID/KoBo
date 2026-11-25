import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { BellRing, GraduationCap, Lock, PhoneCall, ShieldCheck, UserRound } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/AppContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { Avatar } from '../components/ui/Avatar';
import { AccountSecurityCard } from '../components/auth/AccountSecurityCard';
import { StudentVerificationCard } from '../components/profile/StudentVerificationCard';
import { EmergencyContactCard, RemindersCard } from '../components/profile/ConsentCards';
import { SettingsNav, type SettingsNavGroup } from '../components/profile/SettingsNav';
import { useSession } from '../lib/session';
import { safeNext } from '../lib/safeNext';
import { useMyDiscountStatus } from '../components/booking/CampusDiscountCard';
import { useTRPC } from '../lib/trpc';
import { CAMPUS_RETURN_MESSAGES, messageForError } from '../lib/errors';
import '../styles/profile-settings.css';

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

const TITLES: Record<string, { title: string; desc: string }> = {
  '': { title: 'Profil', desc: 'Nama, nomor WhatsApp, dan kampus yang tampil di pengajuan sewa Anda.' },
  verifikasi: { title: 'Verifikasi mahasiswa', desc: 'KoBo khusus mahasiswa. Verifikasi dulu untuk menjadwalkan survey dan mengajukan sewa.' },
  'kontak-darurat': { title: 'Kontak darurat', desc: 'Wajib diisi sebelum pengajuan sewa pertama.' },
  notifikasi: { title: 'Notifikasi', desc: 'Pengingat tagihan untuk Anda sendiri.' },
  keamanan: { title: 'Keamanan akun', desc: 'Kata sandi dan akun yang tertaut.' },
};

export const Profile: React.FC = () => {
  useDocumentTitle('Profil');
  const { addToast, openAuthModal } = useAppStore();
  const { me, isLoading } = useSession();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const save = useMutation(trpc.auth.updateProfile.mutationOptions());
  const { section = '' } = useParams<{ section?: string }>();
  const { search } = useLocation();

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
  const isDemo = !!me.user.isDemo;

  // Demo accounts keep the reduced page; owners are verified through the owner flow, so they get no student verification.
  const groups: SettingsNavGroup[] = [
    {
      title: 'Akun',
      items: [
        { slug: '', label: 'Profil', Icon: UserRound },
        ...(me.isOwner ? [] : [{ slug: 'verifikasi', label: 'Verifikasi mahasiswa', Icon: GraduationCap }]),
        ...(isDemo ? [] : [{ slug: 'kontak-darurat', label: 'Kontak darurat', Icon: PhoneCall }]),
      ],
    },
    ...(isDemo ? [] : [
      { title: 'Preferensi', items: [{ slug: 'notifikasi', label: 'Notifikasi', Icon: BellRing }] },
      { title: 'Keamanan', items: [{ slug: 'keamanan', label: 'Keamanan akun', Icon: Lock }] },
    ]),
  ];
  const allowed = groups.flatMap((g) => g.items.map((i) => i.slug));
  // Return flows that still point at bare /profile (?campus=, ?sheerid=, ?next=) belong to verification.
  if (section === '' && allowed.includes('verifikasi') && (params.has('campus') || params.has('sheerid') || params.has('next'))) {
    return <Navigate to={`/profile/verifikasi${search}`} replace />;
  }
  if (!allowed.includes(section)) return <Navigate to={`/profile${search}`} replace />;
  const head = TITLES[section]!;

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
    <div className="ps">
      <header className="ps__identity">
        <Avatar src={user.image} name={user.name} size={64} style={{ border: '3px solid var(--primary-light)' }} />
        <div className="ps__identity-text">
          <h1 className="ps__name">{user.name}</h1>
          <p className="ps__email">{user.email}</p>
          {me.campusVerified && (
            <span className="ps__badge"><ShieldCheck size={14} aria-hidden="true" /><span>Mahasiswa Terverifikasi</span></span>
          )}
          {me.campusVerified && <MitraStatusLine />}
        </div>
      </header>
      {backToKos && (
        <Link to={backToKos} data-testid="back-to-kos" className="ps__back">Kembali ke kos</Link>
      )}

      <div className="ps__layout">
        <SettingsNav groups={groups} base="/profile" />
        <main className="ps__pane" aria-labelledby="ps-title">
          <div className="ps__pane-head">
            <h2 id="ps-title" className="ps__pane-title">{head.title}</h2>
            <p className="ps__pane-desc">{head.desc}</p>
          </div>

          {section === '' && (
            <div className="ps__card">
              {isEditing ? (
                <form onSubmit={(e) => void handleSaveProfile(e)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <Input label="Nama Lengkap" value={name} onChange={(e) => setName(e.target.value)} required />
                  <Input label="Nomor WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  <Input label="Asal Kampus / Universitas" value={campus} onChange={(e) => setCampus(e.target.value)} />
                  {error && <Notice tone="error">{error}</Notice>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>Batal</Button>
                    <Button type="submit" variant="primary" size="sm" isLoading={save.isPending}>Simpan Perubahan</Button>
                  </div>
                </form>
              ) : (
                <>
                  <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <div className="ps__row"><dt>Asal Kampus</dt><dd>{user.campus ?? '-'}</dd></div>
                    <div className="ps__row"><dt>Nomor WhatsApp</dt><dd>{user.phone ?? '-'}</dd></div>
                    <div className="ps__row"><dt>Peran Akun</dt><dd>{me.isOwner ? 'Pemilik Kos' : 'Pencari Kos / Mahasiswa'}</dd></div>
                  </dl>
                  <div><Button variant="outline" size="sm" onClick={startEdit}>Ubah Profil</Button></div>
                </>
              )}
            </div>
          )}

          {section === 'verifikasi' && (
            <>
              {campusNotice && <Notice tone={campusNotice.tone}>{campusNotice.text}</Notice>}
              <StudentVerificationCard />
            </>
          )}
          {section === 'kontak-darurat' && <EmergencyContactCard />}
          {section === 'notifikasi' && <RemindersCard />}
          {section === 'keamanan' && <AccountSecurityCard />}
        </main>
      </div>
    </div>
  );
};
