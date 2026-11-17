import React, { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Lock, Mail, Phone, Building2, GraduationCap, CheckCircle2, MailCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { useAppStore } from '../../store/AppContext';
import { GOOGLE_RETURN_FLAG, useAuthActions } from '../../lib/session';
import { useTRPC } from '../../lib/trpc';
import { TERMS_VERSION } from '@kobo/shared/domain';
import { messageForError } from '../../lib/errors';

export type AuthView = 'login' | 'register' | 'verify-sent' | 'unverified' | 'forgot' | 'forgot-sent';

export const AUTH_TITLES: Record<AuthView, string> = {
  login: 'Masuk ke Akun KoBo',
  register: 'Daftar Akun KoBo',
  'verify-sent': 'Cek email Anda',
  unverified: 'Email belum diverifikasi',
  forgot: 'Lupa Kata Sandi',
  'forgot-sent': 'Cek email Anda',
};

/** Where the emailed links land (both are lazy SPA pages). */
const VERIFY_CALLBACK = '/verifikasi-email';
const RESET_REDIRECT = '/reset-password';

const GoogleMark: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.01 24.01 0 0 0 0 21.56l7.98-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

const linkButton: React.CSSProperties = { color: 'var(--primary)', fontWeight: 700, textDecoration: 'underline' };
/** 16px on phones: anything smaller makes iOS zoom the page on focus. */
const fieldStyle: React.CSSProperties = { fontSize: '1rem' };
const column = (gap: string): React.CSSProperties => ({ display: 'flex', flexDirection: 'column', gap });

interface AuthFormProps {
  /** `modal`: the title lives in the dialog header. `page`: the form renders its own h1 and the page frames the two blocks. */
  variant: 'modal' | 'page';
  /** Which side of the /masuk toggle is active; the owner side gets its own heading. */
  role?: 'seeker' | 'owner';
  /** Called after a successful sign-in (before an owner is sent to their workspace). */
  onDone: () => void;
  onViewChange?: (view: AuthView) => void;
  /** Message to show on first render (a failed Google round trip). */
  initialError?: string | null;
}

/**
 * The whole sign-in / register / forgot-password flow, shared by the dialog (pages/AuthModal) and the full page
 * (pages/AuthPage). It renders two sibling blocks: `.auth-main` (form) and `.auth-quick` (one-click tester accounts),
 * so each host decides how they are laid out.
 */
export const AuthForm: React.FC<AuthFormProps> = ({ variant, role = 'seeker', onDone, onViewChange, initialError = null }) => {
  const { addToast } = useAppStore();
  const { demoLogin, refreshSession } = useAuthActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const trpc = useTRPC();
  const uid = useId();

  const [view, setViewState] = useState<AuthView>('login');
  const [busy, setBusy] = useState<'form' | 'student' | 'owner' | 'resend' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const providers = useQuery({ ...trpc.auth.providers.queryOptions(), staleTime: Infinity });
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);

  const isRegister = view === 'register';
  const isPage = variant === 'page';

  const setView = (next: AuthView) => {
    setViewState(next);
    onViewChange?.(next);
  };

  const finish = async (welcome: string) => {
    await refreshSession();
    const me = qc.getQueryData(trpc.auth.me.queryKey());
    addToast(welcome, 'success');
    // Read before onDone navigates away. An owner lands in their workspace (or on the owner page they were sent
    // from); everyone else stays where they were.
    const wantsOwnerPage = isPage && new URLSearchParams(window.location.search).get('next')?.startsWith('/owner/');
    onDone();
    if (me?.isOwner && !wantsOwnerPage) navigate('/owner/dashboard');
  };

  /** Full-page round trip to Google and back to this page. better-auth stays out of the initial chunk. */
  const handleGoogle = async () => {
    setError(null);
    // Not configured on the server: no round trip, just say so.
    if (providers.data && !providers.data.google) {
      setError('Masuk dengan Google belum tersedia saat ini.');
      return;
    }
    setBusy('google');
    try {
      const { authClient } = await import('../../lib/authClient');
      const here = new URL(window.location.href);
      for (const key of [GOOGLE_RETURN_FLAG, 'error', 'error_description']) here.searchParams.delete(key);
      const failed = new URL(here);
      failed.searchParams.set(GOOGLE_RETURN_FLAG, 'gagal');
      const res = await authClient.signIn.social({ provider: 'google', callbackURL: here.href, errorCallbackURL: failed.href });
      if (res.error) throw new Error(res.error.message);
    } catch {
      setError('Masuk dengan Google belum berhasil. Silakan coba lagi.');
      setBusy(null);
    }
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
    await finish(as === 'owner' ? 'Masuk sebagai Pemilik.' : 'Masuk sebagai Mahasiswa.');
    setBusy(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('form');
    setError(null);
    setNotice(null);
    try {
      // The auth client is a separate chunk, fetched only when someone actually submits.
      const { authClient } = await import('../../lib/authClient');
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
          ...({ phone: phone.trim(), termsVersion: TERMS_VERSION } as object),
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
      const { authClient } = await import('../../lib/authClient');
      const { error: err } = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: VERIFY_CALLBACK });
      if (err) setError(messageForError(err));
      else setNotice('Tautan verifikasi dikirim ulang. Periksa kotak masuk dan folder spam Anda.');
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(null);
    }
  };

  const switchView = (next: AuthView) => {
    setView(next);
    setError(null);
    setNotice(null);
  };

  const errorBanner = error && <Notice tone="error">{error}</Notice>;
  const noticeBanner = notice && <Notice tone="success">{notice}</Notice>;

  const emailField = (
    <Input
      id={`${uid}-email`}
      name="email"
      label="Email"
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      placeholder="nama@email.com"
      iconLeft={<Mail size={16} />}
      autoComplete={view === 'login' ? 'username' : 'email'}
      style={fieldStyle}
      required
    />
  );

  const ownerSide = role === 'owner' && (view === 'login' || view === 'register');
  const heading = isPage && (
    <>
      <h1 className="auth-title">
        {ownerSide ? (isRegister ? 'Daftar Akun Pemilik Kos' : 'Masuk ke Portal Pemilik Kos') : AUTH_TITLES[view]}
      </h1>
      {ownerSide && (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: '-0.6rem' }}>
          Akun yang sama untuk mencari kos dan mengelola kos. Setelah masuk, daftarkan kos Anda di portal pemilik.
        </p>
      )}
    </>
  );
  const showQuick = view === 'login' || view === 'register';

  let main: React.ReactNode;
  if (view === 'verify-sent' || view === 'unverified') {
    main = (
      <div style={{ ...column('1.25rem'), textAlign: 'center', alignItems: 'center' }}>
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
        <div style={{ ...column('0.6rem'), width: '100%', textAlign: 'left' }}>
          {errorBanner}
          {noticeBanner}
        </div>
        <div style={{ ...column('0.6rem'), width: '100%' }}>
          <Button variant="primary" fullWidth onClick={() => switchView('login')}>
            Lanjut ke Masuk
          </Button>
          <Button variant="outline" fullWidth isLoading={busy === 'resend'} disabled={busy !== null} onClick={handleResend}>
            Kirim ulang email verifikasi
          </Button>
        </div>
      </div>
    );
  } else if (view === 'forgot-sent') {
    main = (
      <div style={{ ...column('1.25rem'), textAlign: 'center', alignItems: 'center' }}>
        <MailCheck size={40} color="var(--primary)" />
        <p style={{ fontSize: '0.95rem', color: 'var(--text-main)', lineHeight: 1.55 }}>
          Jika <strong>{email}</strong> terdaftar, kami telah mengirim tautan untuk mengatur ulang kata sandi. Tautan berlaku satu jam.
        </p>
        <Button variant="primary" fullWidth onClick={() => switchView('login')}>
          Kembali ke Masuk
        </Button>
      </div>
    );
  } else if (view === 'forgot') {
    main = (
      <form onSubmit={handleSubmit} style={column('1.25rem')}>
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
    );
  } else {
    main = (
      <div style={column('0.9rem')}>
        {errorBanner}

        <form onSubmit={handleSubmit} style={column('0.8rem')}>
          {isRegister && (
            <Input
              id={`${uid}-name`}
              name="name"
              label="Nama Lengkap"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama sesuai identitas"
              maxLength={80}
              iconLeft={<User size={16} />}
              autoComplete="name"
              style={fieldStyle}
              required
            />
          )}

          {emailField}

          {isRegister && (
            <Input
              id={`${uid}-phone`}
              name="phone"
              label="Nomor WhatsApp Aktif"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="081234567890"
              iconLeft={<Phone size={16} />}
              autoComplete="tel"
              style={fieldStyle}
            />
          )}

          <Input
            id={`${uid}-password`}
            name="password"
            label="Kata Sandi"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimal 8 karakter"
            iconLeft={<Lock size={16} />}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={isRegister ? 8 : undefined}
            style={fieldStyle}
            required
          />

          {isRegister && (
            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--text-main)' }}>
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required style={{ marginTop: '0.2rem' }} />
              <span>
                Saya menyetujui <Link to="/syarat" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>Syarat dan Ketentuan</Link> dan <Link to="/privasi" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>Kebijakan Privasi</Link> (draf, versi {TERMS_VERSION}).
              </span>
            </label>
          )}

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

        {/* Email and password stay the default path; Google is the alternative below the divider. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          <span style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-subtle)' }} />
          <span>atau</span>
          <span style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-subtle)' }} />
        </div>
        <Button
          variant="outline"
          fullWidth
          icon={<GoogleMark />}
          isLoading={busy === 'google'}
          disabled={busy !== null}
          style={{ minHeight: '46px', backgroundColor: 'var(--bg-surface)' }}
          onClick={handleGoogle}
        >
          Lanjutkan dengan Google
        </Button>

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
    );
  }

  return (
    <div className="auth-body" style={column(isPage ? '1rem' : '0.9rem')}>
      <div className="auth-main" style={column('1.1rem')}>
        {heading}
        {main}
      </div>

      {/* One-click sign-in with the seeded accounts: no registration or inbox needed. Kept below the form so it
          never pushes the real sign-in down. */}
      {showQuick && (
        <div
          className="auth-quick"
          style={{ ...column('0.55rem'), paddingTop: isPage ? undefined : '1rem', borderTop: isPage ? undefined : '1px solid var(--border-subtle)' }}
        >
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>Coba tanpa mendaftar</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'var(--auth-quick-cols, 1fr)', gap: '0.5rem' }}>
            <Button
              variant="outline"
              size="sm"
              fullWidth
              icon={<GraduationCap size={15} />}
              isLoading={busy === 'student'}
              disabled={busy !== null}
              style={{ backgroundColor: 'var(--bg-surface)', whiteSpace: 'nowrap' }}
              onClick={() => handleDemo('student')}
            >
              Masuk sebagai Mahasiswa
            </Button>
            <Button
              variant="outline"
              size="sm"
              fullWidth
              icon={<Building2 size={15} />}
              isLoading={busy === 'owner'}
              disabled={busy !== null}
              style={{ backgroundColor: 'var(--bg-surface)', whiteSpace: 'nowrap' }}
              onClick={() => handleDemo('owner')}
            >
              Masuk sebagai Pemilik
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
