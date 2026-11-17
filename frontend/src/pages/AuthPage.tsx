import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { AuthForm } from '../components/auth/AuthForm';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { GOOGLE_RETURN_FLAG, takeGoogleReturnError, useSession } from '../lib/session';
import seekerPhoto from '../assets/room-survey.webp';
import ownerPhoto from '../assets/room-living.webp';
import '../styles/auth-page.css';

/** Only same-site paths: a `next` of `//evil.example` or `https://...` falls back to the home page. */
function safeNext(raw: string | null, fallback = '/'): string {
  if (!raw) return fallback;
  try {
    // Parse instead of prefix-matching: browsers read "/\evil.example" as "//evil.example".
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin || u.pathname.startsWith('/masuk')) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

type AuthRole = 'seeker' | 'owner';

const ASIDE: Record<AuthRole, { title: string; points: string[] }> = {
  seeker: {
    title: 'Temukan kos yang cocok, dekat kampus Anda.',
    points: ['Ajukan sewa, bayar setelah disetujui pemilik', 'Harga dan fasilitas yang jelas', 'Kuitansi digital untuk setiap pembayaran'],
  },
  owner: {
    title: 'Kelola kos Anda dengan lebih tenang.',
    points: ['Papan okupansi dengan 5 status kamar', 'Tagihan WhatsApp sekali klik', 'Kuitansi digital sekali klik'],
  },
};

/**
 * Full-page sign-in at /masuk: the one place to sign in or register. Gated actions (`openAuthModal`) redirect here
 * with `?next=<where they were>`; `?peran=pemilik` opens the owner side of the toggle. The typed email survives a
 * role switch because the form stays mounted.
 */
export const AuthPage: React.FC = () => {
  useDocumentTitle('Masuk');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const role: AuthRole = params.get('peran') === 'pemilik' ? 'owner' : 'seeker';
  const next = safeNext(params.get('next'), role === 'owner' ? '/owner/login' : '/');
  const { me, isLoading } = useSession();
  const setRole = (r: AuthRole) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (r === 'owner') p.set('peran', 'pemilik');
        else p.delete('peran');
        return p;
      },
      { replace: true },
    );

  // A failed Google round trip lands here with ?google=gagal: show it inline and clean the URL.
  const [initialError] = useState(() =>
    new URLSearchParams(window.location.search).get(GOOGLE_RETURN_FLAG) === 'gagal'
      ? 'Masuk dengan Google belum berhasil. Silakan coba lagi.'
      : takeGoogleReturnError(),
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
      <main className="auth-shell">
        <aside className="auth-shell__aside">
          {/* Both photos stay mounted and cross-fade with the role toggle. */}
          <img className={`auth-shell__photo${role === 'seeker' ? ' is-on' : ''}`} src={seekerPhoto} alt="" />
          <img className={`auth-shell__photo${role === 'owner' ? ' is-on' : ''}`} src={ownerPhoto} alt="" />
          <Link to={next} className="auth-page__back">
            <ArrowLeft size={16} aria-hidden="true" />
            Kembali
          </Link>
          <div className="auth-shell__copy" key={role}>
            <h2 className="auth-shell__headline">{ASIDE[role].title}</h2>
            <ul className="auth-shell__points">
              {ASIDE[role].points.map((p) => (
                <li key={p}>
                  <Check size={16} aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <section className="auth-shell__panel">
          <div className="kobo-segmented auth-page__role" data-role={role} role="group" aria-label="Masuk sebagai">
            <button type="button" aria-pressed={role === 'seeker'} onClick={() => setRole('seeker')}>Pencari kos</button>
            <button type="button" aria-pressed={role === 'owner'} onClick={() => setRole('owner')}>Pemilik kos</button>
          </div>
          <AuthForm variant="page" role={role} onDone={() => navigate(next, { replace: true })} initialError={initialError} />
        </section>
      </main>
    </div>
  );
};
