import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { User, Lock, Mail, Phone, Building2, GraduationCap, CheckCircle2, MailCheck } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { useAppStore } from '../store/AppContext';
import { useAuthActions } from '../lib/session';
import { useTRPC } from '../lib/trpc';
import { messageForError } from '../lib/errors';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type View = 'login' | 'register' | 'verify-sent' | 'unverified' | 'forgot' | 'forgot-sent';

/** Where the emailed links land (both are lazy SPA pages). */
const VERIFY_CALLBACK = '/verifikasi-email';
const RESET_REDIRECT = '/reset-password';

const TITLES: Record<View, string> = {
  login: 'Masuk ke Akun KoBo',
  register: 'Daftar Akun KoBo',
  'verify-sent': 'Cek email Anda',
  unverified: 'Email belum diverifikasi',
  forgot: 'Lupa Kata Sandi',
  'forgot-sent': 'Cek email Anda',
};

const linkButton: React.CSSProperties = { color: 'var(--primary)', fontWeight: 700, textDecoration: 'underline' };

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { addToast } = useAppStore();
  const { demoLogin, refreshSession } = useAuthActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const trpc = useTRPC();

  const [view, setView] = useState<View>('login');
  const [busy, setBusy] = useState<'form' | 'student' | 'owner' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const isRegister = view === 'register';

  const finish = async (welcome: string) => {
    await refreshSession();
    const me = qc.getQueryData(trpc.auth.me.queryKey());
    addToast(welcome, 'success');
    onClose();
    // An owner always lands in their workspace; everyone else stays where they were.
    if (me?.isOwner) navigate('/owner/dashboard');
  };

  const handleDemo = async (as: 'student' | 'owner') => {
    setBusy(as);
    setError(null);
    const failure = await demoLogin(as);
    if (failure) {
      setError(failure);
      setBusy(null);
      return;
    }
    await finish(as === 'owner' ? 'Masuk sebagai Demo Pemilik.' : 'Masuk sebagai Demo Mahasiswa.');
    setBusy(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('form');
    setError(null);
    setNotice(null);
    try {
      // The auth client is a separate chunk, fetched only when someone actually submits.
      const { authClient } = await import('../lib/authClient');
      if (view === 'forgot') {
        const { error: err } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: RESET_REDIRECT });
        // The server answers the same for unknown emails, so this never reveals who has an account.
        if (err) setError(messageForError(err));
        else setView('forgot-sent');
      } else if (isRegister) {
        const { error: err } = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim(),
          password,
          callbackURL: VERIFY_CALLBACK,
          ...({ phone: phone.trim() } as object),
        });
        if (err) setError(messageForError(err));
        else setView('verify-sent');
      } else {
        const { data, error: err } = await authClient.signIn.email({ email: email.trim(), password, callbackURL: VERIFY_CALLBACK });
        if (err?.code === 'EMAIL_NOT_VERIFIED') setView('unverified');
        else if (err || !data) setError(messageForError(err));
        else await finish('Selamat datang kembali di KoBo!');
      }
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(null);
    }
  };

  /** Re-send the verification link. Rate limited server-side (3 per minute), surfaced as a 429 message. */
  const handleResend = async () => {
    setBusy('resend');
    setError(null);
    setNotice(null);
    try {
      const { authClient } = await import('../lib/authClient');
      const { error: err } = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: VERIFY_CALLBACK });
      if (err) setError(messageForError(err));
      else setNotice('Tautan verifikasi dikirim ulang. Periksa kotak masuk dan folder spam Anda.');
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(null);
    }
  };

  const switchView = (next: View) => {
    setView(next);
    setError(null);
    setNotice(null);
  };

  const errorBanner = error && <Notice tone="error">{error}</Notice>;
  const noticeBanner = notice && <Notice tone="success">{notice}</Notice>;

  const emailField = (
    <Input
      label="Email"
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      placeholder="nama@email.com"
      iconLeft={<Mail size={16} />}
      autoComplete="email"
      required
    />
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <User size={20} color="var(--primary)" />
          <span>{TITLES[view]}</span>
        </div>
      }
      subtitle={view === 'login' || view === 'register' ? 'Cari kos, atau kelola kos Anda' : undefined}
      maxWidth="sm"
    >
      {view === 'verify-sent' || view === 'unverified' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center', alignItems: 'center' }}>
          <MailCheck size={40} color="var(--primary)" />
          <p style={{ fontSize: '0.95rem', color: 'var(--text-main)', lineHeight: 1.55 }}>
            {view === 'verify-sent' ? (
              <>
                Kami mengirim tautan verifikasi ke <strong>{email}</strong>. Buka email tersebut untuk mengaktifkan akun, lalu masuk.
              </>
            ) : (
              <>
                Akun <strong>{email}</strong> belum diverifikasi. Buka tautan di email pendaftaran, atau kirim ulang tautannya.
              </>
            )}
          </p>
          <div style={{ width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {errorBanner}
            {noticeBanner}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }}>
            <Button variant="primary" fullWidth onClick={() => switchView('login')}>
              Lanjut ke Masuk
            </Button>
            <Button variant="outline" fullWidth isLoading={busy === 'resend'} disabled={busy !== null} onClick={handleResend}>
              Kirim ulang email verifikasi
            </Button>
          </div>
        </div>
      ) : view === 'forgot-sent' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center', alignItems: 'center' }}>
          <MailCheck size={40} color="var(--primary)" />
          <p style={{ fontSize: '0.95rem', color: 'var(--text-main)', lineHeight: 1.55 }}>
            Jika <strong>{email}</strong> terdaftar, kami telah mengirim tautan untuk mengatur ulang kata sandi. Tautan berlaku satu jam.
          </p>
          <Button variant="primary" fullWidth onClick={() => switchView('login')}>
            Kembali ke Masuk
          </Button>
        </div>
      ) : view === 'forgot' ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Masukkan email akun Anda. Kami akan mengirim tautan untuk membuat kata sandi baru.
          </p>
          {errorBanner}
          {emailField}
          <Button type="submit" variant="primary" fullWidth isLoading={busy === 'form'} disabled={busy !== null}>
            Kirim Tautan Atur Ulang
          </Button>
          <button type="button" onClick={() => switchView('login')} style={{ ...linkButton, fontSize: '0.85rem' }}>
            Kembali ke Masuk
          </button>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {errorBanner}

          {/* One-click demo accounts: reviewers should never need to register or open an inbox. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
              padding: '0.9rem',
              backgroundColor: 'var(--primary-light)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)' }}>Coba tanpa mendaftar</span>
            <Button
              variant="primary"
              fullWidth
              icon={<GraduationCap size={16} />}
              isLoading={busy === 'student'}
              disabled={busy !== null}
              onClick={() => handleDemo('student')}
            >
              Masuk sebagai Demo Mahasiswa
            </Button>
            <Button
              variant="outline"
              fullWidth
              icon={<Building2 size={16} />}
              isLoading={busy === 'owner'}
              disabled={busy !== null}
              style={{ backgroundColor: 'var(--bg-surface)' }}
              onClick={() => handleDemo('owner')}
            >
              Masuk sebagai Demo Pemilik
            </Button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-subtle)', fontSize: '0.78rem' }}>
            <span style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-subtle)' }} />
            <span>atau dengan email</span>
            <span style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-subtle)' }} />
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {isRegister && (
              <Input
                label="Nama Lengkap"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Rafi Aditya"
                iconLeft={<User size={16} />}
                autoComplete="name"
                required
              />
            )}

            {emailField}

            {isRegister && (
              <Input
                label="Nomor WhatsApp Aktif"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="081234567890"
                iconLeft={<Phone size={16} />}
                autoComplete="tel"
              />
            )}

            <Input
              label="Kata Sandi"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimal 8 karakter"
              iconLeft={<Lock size={16} />}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              minLength={isRegister ? 8 : undefined}
              required
            />

            {!isRegister && (
              <button
                type="button"
                onClick={() => switchView('forgot')}
                style={{ ...linkButton, alignSelf: 'flex-end', marginTop: '-0.4rem', fontWeight: 600, fontSize: '0.8rem' }}
              >
                Lupa kata sandi?
              </button>
            )}

            <Button type="submit" variant="primary" fullWidth icon={isRegister ? <CheckCircle2 size={16} /> : undefined} isLoading={busy === 'form'} disabled={busy !== null}>
              {isRegister ? 'Daftar Sekarang' : 'Masuk ke Akun'}
            </Button>
          </form>

          <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {isRegister ? (
              <span>
                Sudah punya akun?{' '}
                <button type="button" onClick={() => switchView('login')} style={linkButton}>
                  Masuk di sini
                </button>
              </span>
            ) : (
              <span>
                Belum punya akun?{' '}
                <button type="button" onClick={() => switchView('register')} style={linkButton}>
                  Daftar baru
                </button>
              </span>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};
