import React, { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Users, Lock, Mail, Phone, Building2, GraduationCap, CheckCircle2, MailCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Notice } from '../ui/Notice';
import { useAppStore } from '../../store/AppContext';
import { GOOGLE_RETURN_FLAG, clearGoogleRoundTrip, clearPendingGoogleTerms, markGoogleRoundTrip, readPendingGoogleTerms, useAuthActions, type DemoLoginAs, type useSession } from '../../lib/session';
import { useTRPC } from '../../lib/trpc';
import { TERMS_VERSION } from '@kobo/shared/domain';
import { messageForError } from '../../lib/errors';
import { safeNext } from '../../lib/safeNext';
import { VerifyCodeStep } from './VerifyCodeStep';

export type AuthView = 'login' | 'register' | 'verify-sent' | 'unverified' | 'forgot' | 'forgot-sent';

export const AUTH_TITLES: Record<AuthView, string> = {
  login: 'Masuk ke Akun KoBo',
  register: 'Daftar Akun KoBo',
  'verify-sent': 'Verifikasi email Anda',
  unverified: 'Email belum diverifikasi',
  forgot: 'Lupa Kata Sandi',
  'forgot-sent': 'Cek email Anda',
};

type SessionMe = ReturnType<typeof useSession>['me'];

/** Non-sensitive sign-up progress that survives a refresh. Never the password, the OTP or a file. */
const SIGNUP_KEY = 'kobo.signup';
export { readPendingGoogleTerms, clearPendingGoogleTerms };
export interface SignupDraft {
  name: string;
  email: string;
  phone: string;
  role: 'seeker' | 'owner';
  /** Furthest step reached, 1-based. */
  step: number;
  next: string;
}
export function readSignup(): Partial<SignupDraft> {
  try {
    const raw = sessionStorage.getItem(SIGNUP_KEY);
    return raw ? (JSON.parse(raw) as Partial<SignupDraft>) : {};
  } catch {
    return {};
  }
}
export function writeSignup(patch: Partial<SignupDraft>): void {
  try {
    sessionStorage.setItem(SIGNUP_KEY, JSON.stringify({ ...readSignup(), ...patch }));
  } catch {
    /* storage unavailable: the flow still works, it just cannot resume */
  }
}
export function clearSignup(): void {
  try {
    sessionStorage.removeItem(SIGNUP_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Where the emailed password-reset link lands (a lazy SPA page). */
const RESET_REDIRECT = '/reset-password';
/** On /masuk?next=X the reset link keeps X (through safeNext) so the whole trip ends where it began. */
const resetRedirect = (): string => {
  const raw = new URLSearchParams(window.location.search).get('next');
  if (!raw) return RESET_REDIRECT;
  const next = safeNext(raw);
  return next === '/' ? RESET_REDIRECT : `${RESET_REDIRECT}?next=${encodeURIComponent(next)}`;
};

const GoogleMark: React.FC<{ mono?: boolean }> = ({ mono = false }) => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false" style={mono ? { filter: 'brightness(0) invert(1)' } : undefined}>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.01 24.01 0 0 0 0 21.56l7.98-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

const linkButton: React.CSSProperties = { color: 'var(--primary)', fontWeight: 700, textDecoration: 'underline' };
/** 16px on phones: anything smaller makes iOS zoom the page on focus. */
const fieldStyle: React.CSSProperties = { fontSize: 'var(--step-0)' };
const column = (gap: string): React.CSSProperties => ({ display: 'flex', flexDirection: 'column', gap });

interface AuthFormProps {
  /** `modal`: the title lives in the dialog header. `page`: the form renders its own h1 and the page frames the two blocks. */
  variant: 'modal' | 'page';
  /** Which side of the /masuk toggle is active; the owner side gets its own heading. */
  role?: 'seeker' | 'owner';
  /** Called after a successful sign-in (before an owner is sent to their workspace). Page variant: return true when the caller routed the user itself. */
  onDone: (me?: SessionMe) => boolean | void;
  /** Page variant: the sign-up step the URL says we are on (0 = sign-in, 1 = account form, 2 = email code). */
  signupStep?: 0 | 1 | 2;
  /** Page variant: the form moved to another sign-up step (the caller mirrors it in `?langkah=`). */
  onSignupStep?: (step: 0 | 1 | 2) => void;
  /** Page variant: the email code was accepted and the session exists; the caller shows the next step. */
  onVerified?: () => void;
  onViewChange?: (view: AuthView) => void;
  /** Message to show on first render (a failed Google round trip). */
  initialError?: string | null;
}

/**
 * The whole sign-in / register / forgot-password flow, shared by the dialog (pages/AuthModal) and the full page
 * (pages/AuthPage). It renders two sibling blocks: `.auth-main` (form) and `.auth-quick` (one-click tester accounts),
 * so each host decides how they are laid out.
 */
export const AuthForm: React.FC<AuthFormProps> = ({ variant, role = 'seeker', onDone, signupStep, onSignupStep, onVerified, onViewChange, initialError = null }) => {
  const { addToast } = useAppStore();
  const { demoLogin, refreshSession } = useAuthActions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const trpc = useTRPC();
  const uid = useId();

  const isPage = variant === 'page';
  const saved = isPage ? readSignup() : {};
  const [view, setViewState] = useState<AuthView>(() => (isPage && signupStep === 1 ? 'register' : isPage && signupStep === 2 ? (saved.email ? 'verify-sent' : 'register') : 'login'));
  const [busy, setBusy] = useState<'form' | DemoLoginAs | 'google' | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const providers = useQuery({ ...trpc.auth.providers.queryOptions(), staleTime: Infinity });
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState(saved.name ?? '');
  const [email, setEmail] = useState(saved.email ?? '');
  const [phone, setPhone] = useState(saved.phone ?? '');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [googleTermsOpen, setGoogleTermsOpen] = useState(false);
  const [googleAgreed, setGoogleAgreed] = useState(false);

  const isRegister = view === 'register';

  const stepOf = (v: AuthView): 0 | 1 | 2 => (v === 'register' ? 1 : v === 'verify-sent' || v === 'unverified' ? 2 : 0);
  const setView = (next: AuthView) => {
    setViewState(next);
    onViewChange?.(next);
    if (isPage && stepOf(next) !== stepOf(view)) onSignupStep?.(stepOf(next));
  };

  // Keep what was typed (never the password) so a refresh or the browser Back button does not lose it.
  useEffect(() => {
    if (isPage) writeSignup({ name, email, phone });
  }, [isPage, name, email, phone]);

  // The URL is the source of truth for the sign-up step: browser Back and Forward move the form with it.
  useEffect(() => {
    if (!isPage || signupStep === undefined) return;
    setViewState((v) => {
      if (stepOf(v) === signupStep) return v;
      if (signupStep === 1) return 'register';
      if (signupStep === 2) return email.trim() ? 'verify-sent' : 'register';
      return v === 'forgot' || v === 'forgot-sent' ? v : 'login';
    });
  }, [signupStep]); // eslint-disable-line react-hooks/exhaustive-deps -- only a step change from outside should move the view

  const finish = async (welcome: string, defaultDest?: string) => {
    await refreshSession();
    const me = qc.getQueryData(trpc.auth.me.queryKey());
    addToast(welcome, 'success');
    // Read before onDone navigates away. An owner always lands on their dashboard unless a route guard sent them
    // to a specific `?next=/owner/...` page; a renter stays where they were.
    const nextParam = isPage ? new URLSearchParams(window.location.search).get('next') : null;
    const hasOwnNext = /^\/owner(\/|$)/.test(safeNext(nextParam));
    if (onDone(me) === true) return;
    if (me?.isOwner && !hasOwnNext) navigate('/owner/dashboard');
    else if (defaultDest && !hasOwnNext) navigate(defaultDest, { replace: true });
  };

  /** Full-page round trip to Google and back to this page. better-auth stays out of the initial chunk. */
  const startGoogle = async () => {
    setError(null);
    setBusy('google');
    markGoogleRoundTrip(TERMS_VERSION);
    try {
      const { authClient } = await import('../../lib/authClient');
      const here = new URL(window.location.href);
      for (const key of [GOOGLE_RETURN_FLAG, 'error', 'error_description']) here.searchParams.delete(key);
      const failed = new URL(here);
      failed.searchParams.set(GOOGLE_RETURN_FLAG, 'gagal');
      const res = await authClient.signIn.social({ provider: 'google', callbackURL: here.href, errorCallbackURL: failed.href });
      if (res.error) throw new Error(res.error.message);
    } catch {
      clearGoogleRoundTrip();
      setError('Masuk dengan Google belum berhasil. Silakan coba lagi.');
      setBusy(null);
      setGoogleTermsOpen(false);
    }
  };

  /** Require Terms & Privacy agreement before redirecting out to Google OAuth. */
  const handleGoogle = () => {
    setError(null);
    // Not configured on the server: no round trip, just say so.
    if (providers.data && !providers.data.google) {
      setError('Masuk dengan Google belum tersedia saat ini.');
      return;
    }
    if (isRegister && agreed) {
      void startGoogle();
      return;
    }
    setGoogleAgreed(false);
    setGoogleTermsOpen(true);
  };

  const handleDemo = async (as: DemoLoginAs) => {
    setBusy(as);
    setError(null);
    const failure = await demoLogin(as);
    if (failure) {
      setError(failure);
      setBusy(null);
      return;
    }
    const toast =
      as === 'owner'
        ? 'Masuk sebagai Pemilik.'
        : as === 'temanA'
          ? 'Masuk sebagai Nadia (Teman Sekamar 1).'
          : as === 'temanB'
            ? 'Masuk sebagai Clara (Teman Sekamar 2).'
            : 'Masuk sebagai Mahasiswa.';
    const dest = as === 'temanA' || as === 'temanB' ? '/teman-sekamar/pesan/match-conn-demo-teman' : undefined;
    await finish(toast, dest);
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
        const { error: err } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: resetRedirect() });
        // The server answers the same for unknown emails, so this never reveals who has an account.
        if (err) setError(messageForError(err));
        else setView('forgot-sent');
      } else if (isRegister) {
        const { error: err } = await authClient.signUp.email({
          name: name.trim(),
          email: email.trim(),
          password,
          ...({ phone: phone.trim(), termsVersion: TERMS_VERSION } as object),
        });
        if (err) setError(messageForError(err));
        else setView('verify-sent');
      } else {
        const { data, error: err } = await authClient.signIn.email({ email: email.trim(), password });
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
      <h1 id="auth-step-heading" className="auth-title" tabIndex={-1} data-step-heading>
        {ownerSide ? (isRegister ? 'Daftar Akun Pemilik Kos' : 'Masuk ke Portal Pemilik Kos') : AUTH_TITLES[view]}
      </h1>
    </>
  );
  const showQuick = view === 'login' || view === 'register';

  let main: React.ReactNode;
  if (view === 'verify-sent' || view === 'unverified') {
    main = (
      <VerifyCodeStep
        email={email.trim()}
        onBack={() => switchView(view === 'verify-sent' ? 'register' : 'login')}
        backLabel={view === 'verify-sent' ? 'Ganti email' : 'Kembali ke Masuk'}
        onVerified={async () => {
          // On the stepped page the account now exists: show the next step instead of leaving.
          if (isPage && onVerified) {
            await refreshSession();
            addToast('Email terverifikasi.', 'success');
            onVerified();
            return;
          }
          await finish('Email terverifikasi. Selamat datang di KoBo!');
        }}
      />
    );
  } else if (view === 'forgot-sent') {
    main = (
      <div style={{ ...column('1.25rem'), textAlign: 'center', alignItems: 'center' }}>
        <MailCheck size={40} color="var(--primary)" />
        <p style={{ fontSize: 'var(--step-0)', color: 'var(--text-main)', lineHeight: 1.55 }}>
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
        <p style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Masukkan email akun Anda. Kami akan mengirim tautan untuk membuat kata sandi baru.
        </p>
        {errorBanner}
        {emailField}
        <Button type="submit" variant="primary" fullWidth isLoading={busy === 'form'} disabled={busy !== null}>
          Kirim Tautan Atur Ulang
        </Button>
        <button type="button" onClick={() => switchView('login')} style={{ ...linkButton, fontSize: 'var(--step--1)' }}>
          Kembali ke Masuk
        </button>
      </form>
    );
  } else {
    main = (
      <div style={column('0.9rem')}>
        {errorBanner}

        <form onSubmit={handleSubmit} style={column('0.8rem')}>
          {/* Register on the full page lays these four out 2x2 (auth-page.css) so the form fits one screen. */}
          <div className={isRegister ? 'auth-fields auth-fields--reg' : 'auth-fields'} style={column('0.8rem')}>
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
          </div>

          {isRegister && (
            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: 'var(--step--1)', lineHeight: 1.5, color: 'var(--text-main)' }}>
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required style={{ marginTop: '0.2rem' }} />
              <span>
                Saya menyetujui <Link to="/syarat" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>Syarat dan Ketentuan</Link> dan <Link to="/privasi" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>Kebijakan Privasi</Link>.
              </span>
            </label>
          )}

          {!isRegister && (
            <button
              type="button"
              onClick={() => switchView('forgot')}
              style={{ ...linkButton, alignSelf: 'flex-end', marginTop: '-0.4rem', fontWeight: 600, fontSize: 'var(--step--1)' }}
            >
              Lupa kata sandi?
            </button>
          )}

          <Button type="submit" variant="primary" fullWidth icon={isRegister ? <CheckCircle2 size={16} /> : undefined} isLoading={busy === 'form'} disabled={busy !== null}>
            {isRegister ? 'Daftar Sekarang' : 'Masuk ke Akun'}
          </Button>
        </form>

        {/* Email and password stay the default path; Google is the alternative below the divider. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-muted)', fontSize: 'var(--step--2)' }}>
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

        <div style={{ textAlign: 'center', fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>
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
          <span style={{ fontSize: 'var(--step--2)', fontWeight: 700, color: 'var(--text-muted)' }}>Coba tanpa mendaftar</span>
          {/* On the page the grid comes from auth-page.css (two columns when they fit, stacked otherwise). */}
          <div
            className="auth-quick__grid"
            style={{ display: 'grid', gridTemplateColumns: isPage ? undefined : 'repeat(auto-fit, minmax(min(100%, 17rem), 1fr))', gap: '0.5rem' }}
          >
            <Button
              variant="outline"
              size="sm"
              fullWidth
              icon={<GraduationCap size={15} />}
              isLoading={busy === 'student'}
              disabled={busy !== null}
              style={{ backgroundColor: 'var(--bg-surface)', whiteSpace: 'nowrap', paddingInline: '0.5rem' }}
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
              style={{ backgroundColor: 'var(--bg-surface)', whiteSpace: 'nowrap', paddingInline: '0.5rem' }}
              onClick={() => handleDemo('owner')}
            >
              Masuk sebagai Pemilik
            </Button>
            <Button
              variant="outline"
              size="sm"
              fullWidth
              icon={<Users size={15} />}
              isLoading={busy === 'temanA'}
              disabled={busy !== null}
              style={{ backgroundColor: 'var(--bg-surface)', whiteSpace: 'nowrap', paddingInline: '0.5rem' }}
              onClick={() => handleDemo('temanA')}
            >
              Teman Sekamar 1 (Nadia)
            </Button>
            <Button
              variant="outline"
              size="sm"
              fullWidth
              icon={<Users size={15} />}
              isLoading={busy === 'temanB'}
              disabled={busy !== null}
              style={{ backgroundColor: 'var(--bg-surface)', whiteSpace: 'nowrap', paddingInline: '0.5rem' }}
              onClick={() => handleDemo('temanB')}
            >
              Teman Sekamar 2 (Clara)
            </Button>
          </div>
        </div>
      )}

      <Modal
        isOpen={googleTermsOpen}
        onClose={() => { if (busy !== 'google') setGoogleTermsOpen(false); }}
        title="Syarat dan Ketentuan"
        maxWidth="sm"
      >
        <div style={column('1rem')}>
          <p style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', lineHeight: 1.55, margin: 0 }}>
            Sebelum melanjutkan dengan Google, baca dan setujui Syarat dan Ketentuan serta Kebijakan Privasi KoBo.
          </p>
          <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: 'var(--step--1)', lineHeight: 1.5, color: 'var(--text-main)' }}>
            <input
              type="checkbox"
              checked={googleAgreed}
              disabled={busy === 'google'}
              onChange={(e) => setGoogleAgreed(e.target.checked)}
              style={{ marginTop: '0.2rem', flexShrink: 0 }}
            />
            <span>
              Saya menyetujui{' '}
              <Link to="/syarat" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>Syarat dan Ketentuan</Link>
              {' '}dan{' '}
              <Link to="/privasi" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>Kebijakan Privasi</Link>.
            </span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.6rem' }}>
            <Button type="button" variant="danger" fullWidth disabled={busy === 'google'} onClick={() => setGoogleTermsOpen(false)}>
              Batal
            </Button>
            <Button
              type="button"
              variant="primary"
              fullWidth
              icon={<GoogleMark mono />}
              isLoading={busy === 'google'}
              disabled={!googleAgreed || busy !== null}
              onClick={() => void startGoogle()}
            >
              Setuju & Lanjutkan
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
