import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AuthForm } from '../components/auth/AuthForm';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { GOOGLE_RETURN_FLAG, useSession } from '../lib/session';
import '../styles/auth-page.css';

/** Only same-site paths: a `next` of `//evil.example` or `https://...` falls back to the home page. */
function safeNext(raw: string | null): string {
  if (!raw) return '/';
  try {
    // Parse instead of prefix-matching: browsers read "/\evil.example" as "//evil.example".
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin || u.pathname.startsWith('/masuk')) return '/';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/';
  }
}

/**
 * Full-page sign-in at /masuk: the destination for the navbar button and deep links, and the form password managers
 * handle best. The dialog (pages/AuthModal) stays for gated actions that must not leave the page.
 */
export const AuthPage: React.FC = () => {
  useDocumentTitle('Masuk');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { me, isLoading } = useSession();

  // A failed Google round trip lands here with ?google=gagal: show it inline and clean the URL.
  const [initialError] = useState(() =>
    new URLSearchParams(window.location.search).get(GOOGLE_RETURN_FLAG) === 'gagal'
      ? 'Masuk dengan Google belum berhasil. Silakan coba lagi.'
      : null,
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(GOOGLE_RETURN_FLAG)) return;
    for (const key of [GOOGLE_RETURN_FLAG, 'error', 'error_description']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);

  // Someone who arrives already signed in (or back from a successful Google trip) goes straight on.
  // Signing in through the form is handled by onDone, so only the first answer counts.
  const arrivedSignedIn = useRef<boolean | null>(null);
  useEffect(() => {
    if (isLoading) return;
    if (arrivedSignedIn.current === null) arrivedSignedIn.current = !!me;
    if (arrivedSignedIn.current && me) navigate(me.isOwner && next === '/' ? '/owner/dashboard' : next, { replace: true });
  }, [isLoading, me, next, navigate]);

  return (
    <div className="auth-page landing-backdrop">
      <header className="auth-page__bar">
        <Link to="/" className="auth-page__brand" aria-label="KoBo, ke beranda">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          <span>
            Ko<span style={{ color: 'var(--primary)' }}>Bo</span>
          </span>
        </Link>
        <Link to={next} className="auth-page__back">
          <ArrowLeft size={16} aria-hidden="true" />
          Kembali
        </Link>
      </header>

      <main className="auth-page__stage">
        <AuthForm variant="page" onDone={() => navigate(next, { replace: true })} initialError={initialError} />
        <p className="auth-page__legal">
          Dengan masuk, Anda menyetujui <Link to="/syarat">Syarat Penggunaan</Link> dan <Link to="/privasi">Kebijakan Privasi</Link>.
        </p>
      </main>
    </div>
  );
};
