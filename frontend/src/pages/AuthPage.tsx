import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { AuthForm, clearSignup, readSignup, writeSignup } from '../components/auth/AuthForm';
import { OwnerDataStep } from '../components/auth/OwnerDataStep';
import { OwnerDocsStep } from '../components/auth/OwnerDocsStep';
import { clearKtmDraft, searchTarget, StudentPendingCard, StudentVerifyStep } from '../components/auth/StudentVerifyStep';
import { Button } from '../components/ui/Button';
import { Stepper } from '../components/ui/Stepper';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { safeNext } from '../lib/safeNext';
import { GOOGLE_RETURN_FLAG, takeGoogleReturnError, useAuthActions, useSession } from '../lib/session';
import seekerPhoto from '../assets/room-survey.webp';
import ownerPhoto from '../assets/room-living.webp';
import '../styles/auth-page.css';

/** The routes behind OwnerGuard (/owner/login and /owner/:id are public student-layout pages). */
const OWNER_WORKSPACE = /^\/owner\/(dashboard|kos|reviews)(?:[/?#]|$)/;

type AuthRole = 'seeker' | 'owner';

const ASIDE: Record<AuthRole, { title: string; points: string[] }> = {
  seeker: {
    title: 'Temukan kos yang cocok, dekat kampus Anda.',
    points: ['Ajukan sewa, bayar setelah disetujui pemilik', 'Harga dan fasilitas yang jelas', 'Kuitansi digital untuk setiap pembayaran'],
  },
  owner: {
    title: 'Kelola kos Anda dengan lebih tenang.',
    points: ['Papan okupansi dengan 5 status kamar', 'Pengajuan sewa dan survey dari mahasiswa di satu tempat', 'Kuitansi digital sekali klik'],
  },
};

const STUDENT_STEPS = [
  { id: 'akun', label: 'Akun' },
  { id: 'kode', label: 'Kode email' },
  { id: 'mahasiswa', label: 'Verifikasi mahasiswa (bisa nanti)' },
];
const OWNER_STEPS = [
  { id: 'akun', label: 'Akun' },
  { id: 'kode', label: 'Kode email' },
  { id: 'pemilik', label: 'Data pemilik' },
  { id: 'dokumen', label: 'Dokumen (bisa nanti)' },
];

/**
 * Full-page sign-in and stepped sign-up at /masuk. Gated actions (`openAuthModal`) redirect here with
 * `?next=<where they were>`; `?peran=pemilik` opens the owner side of the toggle; `?langkah=n` is the 1-based sign-up
 * step (pushed on every forward move so browser Back steps back, and clamped to the furthest step reached).
 * The server decides where a signed-in person resumes; sessionStorage only keeps non-sensitive typing.
 */
export const AuthPage: React.FC = () => {
  useDocumentTitle('Masuk');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { me, isLoading } = useSession();
  const { refreshSession } = useAuthActions();
  const [stored] = useState(() => readSignup());

  const urlStep = Math.max(0, Math.floor(Number(params.get('langkah'))) || 0);
  const role: AuthRole = (params.get('peran') ?? (urlStep > 0 && stored.role === 'owner' ? 'pemilik' : '')) === 'pemilik' ? 'owner' : 'seeker';
  const next = safeNext(params.get('next') ?? (urlStep > 0 ? stored.next : null), role === 'owner' ? '/owner/login' : '/');
  // "Kembali" must never land on a page that bounces straight back here: the owner workspace is behind OwnerGuard,
  // so a visitor sent from it goes home instead (F-08).
  const backTo = OWNER_WORKSPACE.test(next) ? '/' : next;
  const steps = role === 'owner' ? OWNER_STEPS : STUDENT_STEPS;
  const doneIdx = steps.length + 1;

  // Furthest step reached (1-based). Server state raises it; a vanished session caps it at the code step.
  const [reached, setReached] = useState(stored.step ?? 0);
  const serverReached = !me
    ? 0
    : role === 'owner'
      ? !me.isOwner ? 3 : me.ownerStatus === 'BELUM_KIRIM' ? 4 : doneIdx
      : me.campusVerified || me.studentVerification.state === 'PENDING' ? doneIdx : 3;
  const furthest = Math.min(me ? Math.max(reached, serverReached) : Math.min(reached, 2), doneIdx);
  const step = urlStep === 0 ? 0 : Math.min(urlStep, Math.max(furthest, 1));

  const go = (n: number, how: 'push' | 'replace' = 'push') =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (n > 0) p.set('langkah', String(n));
        else p.delete('langkah');
        return p;
      },
      { replace: how === 'replace' },
    );
  const reach = (n: number) => {
    setReached((f) => Math.max(f, n));
    writeSignup({ step: Math.max(readSignup().step ?? 0, n) });
  };
  const advance = (n: number) => {
    reach(n);
    go(n, 'push');
  };

  // Typing the URL by hand past what was reached lands on the furthest step.
  useEffect(() => {
    if (isLoading || urlStep === step) return;
    go(step, 'replace');
  }, [isLoading, urlStep, step]); // eslint-disable-line react-hooks/exhaustive-deps -- go() only reads setParams

  useEffect(() => {
    if (step > 0) writeSignup({ role, next });
  }, [step, role, next]);

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

  /** Owner resume point for a signed-in account: no OwnerProfile yet is step 3, documents not sent is step 4. Demo accounts never resume. */
  const ownerResume = (m: NonNullable<typeof me>): number | null => (m.user.isDemo ? null : !m.isOwner ? 3 : m.ownerStatus === 'BELUM_KIRIM' ? 4 : null);

  // Someone who arrives already signed in (or back from a successful Google trip) goes straight on, unless the server
  // says they are mid sign-up. Signing in through the form is handled by onDone, so only the first answer counts.
  const arrivedSignedIn = useRef<boolean | null>(null);
  const arrivalHandled = useRef(false);
  useEffect(() => {
    if (isLoading || arrivalHandled.current) return;
    // Decide once: later `me` changes (OwnerProfile created, documents sent) must not re-route a sign-up in progress.
    arrivalHandled.current = true;
    if (arrivedSignedIn.current === null) {
      arrivedSignedIn.current = !!me;
      // A signed-out visitor cannot be past the code step: a leftover draft from an earlier session is stale.
      if (!me && (stored.step ?? 0) >= 3) {
        clearSignup();
        clearKtmDraft();
        setReached(0);
      }
    }
    if (!arrivedSignedIn.current || !me) return;
    const resume = role === 'owner' ? ownerResume(me) : null;
    if (resume) {
      reach(resume);
      go(resume, 'replace');
    } else if (!(role === 'seeker' && urlStep >= 3) && urlStep !== doneIdx) {
      navigate(me.isOwner && next === '/' ? '/owner/dashboard' : next, { replace: true });
    }
  }, [isLoading, me]); // eslint-disable-line react-hooks/exhaustive-deps -- decided once, on the first answer

  // Signing out clears the draft.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (me) wasSignedIn.current = true;
    else if (wasSignedIn.current) {
      wasSignedIn.current = false;
      clearSignup();
      clearKtmDraft();
    }
  }, [me]);

  // Move focus to the step heading whenever the step changes (not on the first paint).
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    document.querySelector<HTMLElement>('.auth-shell__panel [data-step-heading]')?.focus();
  }, [step]);

  // Completion: nothing left to resume.
  useEffect(() => {
    if (step === doneIdx) {
      clearSignup();
      clearKtmDraft();
    }
  }, [step, doneIdx]);

  /** After a form sign-in: true when the page routed the user itself (an owner mid sign-up). */
  const afterSignIn = (m: typeof me | undefined): boolean => {
    const resume = m && role === 'owner' ? ownerResume(m) : null;
    if (!resume) return false;
    advance(resume);
    return true;
  };

  const finishOwnerStep = async (n: number) => {
    await refreshSession();
    advance(n);
  };
  const studentLater = () => {
    clearSignup();
    clearKtmDraft();
    navigate(searchTarget(next), { replace: true });
  };

  const inSignup = step >= 1;
  const heading = (text: string, sub?: string) => (
    <div>
      <h1 className="auth-title" tabIndex={-1} data-step-heading>{text}</h1>
      {sub && <p className="auth-step__muted" style={{ textAlign: 'center', marginTop: '0.35rem' }}>{sub}</p>}
    </div>
  );
  const resumeStep = Math.min(Math.max(furthest, 3), steps.length);

  let body: React.ReactNode;
  if (isLoading && urlStep >= 3) {
    body = <p role="status" className="auth-step__muted">Memuat…</p>;
  } else if (me && step === doneIdx) {
    if (role === 'owner') {
      const submitted = me.isOwner && me.ownerStatus !== 'BELUM_KIRIM';
      body = (
        <div className="auth-step" data-testid="signup-done">
          {heading(submitted ? 'Dokumen terkirim' : 'Akun pemilik siap')}
          <p className="auth-step__muted" style={{ textAlign: 'center' }}>
            {submitted
              ? 'Kami memeriksa dokumen Anda dan mengabari lewat email.'
              : 'Kirim dokumen kepemilikan dari dashboard sebelum kos Anda dapat dipublikasikan.'}
          </p>
          <Button variant="primary" fullWidth onClick={() => navigate('/owner/dashboard', { replace: true })}>Ke dashboard</Button>
        </div>
      );
    } else {
      const sv = me.studentVerification;
      body = (
        <div className="auth-step" data-testid="signup-done">
          {heading(me.campusVerified ? 'Status mahasiswa terverifikasi' : 'Akun Anda siap')}
          {me.campusVerified ? (
            <Button variant="primary" fullWidth onClick={() => navigate(searchTarget(next), { replace: true })}>Cari kos</Button>
          ) : sv.state === 'PENDING' ? (
            <StudentPendingCard slaText={sv.slaText} next={next} />
          ) : (
            <>
              <p className="auth-step__muted" style={{ textAlign: 'center' }}>Anda bisa mencari kos sekarang. Mengajukan sewa butuh verifikasi mahasiswa.</p>
              <Button variant="primary" fullWidth onClick={() => navigate(`/profile?next=${encodeURIComponent(next)}`, { replace: true })}>Verifikasi nanti di Profil</Button>
              <Button variant="outline" fullWidth onClick={() => navigate(searchTarget(next), { replace: true })}>Cari kos</Button>
            </>
          )}
        </div>
      );
    }
  } else if (me && step >= 3) {
    const id = steps[step - 1]?.id;
    body =
      id === 'mahasiswa' ? (
        <div className="auth-step">
          {heading('Verifikasi status mahasiswa', 'Opsional. Verifikasi diperlukan untuk mengajukan sewa; Anda bisa melakukannya nanti di Profil.')}
          <StudentVerifyStep next={next} onContinue={() => advance(doneIdx)} onLater={studentLater} />
        </div>
      ) : id === 'pemilik' ? (
        <div className="auth-step">
          {heading('Data pemilik kos')}
          <OwnerDataStep onDone={() => void finishOwnerStep(4)} />
        </div>
      ) : (
        <div className="auth-step">
          {heading('Dokumen kepemilikan', 'Bisa dikirim nanti dari dashboard, tetapi kos baru dapat dibuat setelah dokumen diperiksa.')}
          <OwnerDocsStep onDone={() => void finishOwnerStep(doneIdx)} onLater={() => void finishOwnerStep(doneIdx)} />
        </div>
      );
  } else if (me && step === 1) {
    // The account exists: step 1 is a read-only summary (no re-submitting, no email change after the code).
    body = (
      <div className="auth-step">
        {heading('Akun Anda sudah dibuat')}
        <dl className="auth-step__card auth-step__summary">
          <dt>Nama</dt>
          <dd>{me.user.name}</dd>
          <dt>Email</dt>
          <dd>{me.user.email}</dd>
          <dt>Peran</dt>
          <dd>{role === 'owner' ? 'Pemilik kos' : 'Mahasiswa'}</dd>
        </dl>
        <p className="auth-step__muted">Email tidak dapat diganti setelah kodenya diverifikasi.</p>
        <Button variant="primary" fullWidth onClick={() => go(resumeStep)}>Lanjut</Button>
      </div>
    );
  } else if (me && step === 2) {
    body = (
      <div className="auth-step">
        {heading('Email sudah terverifikasi')}
        <Button variant="primary" fullWidth onClick={() => go(resumeStep)}>Lanjut</Button>
      </div>
    );
  } else {
    body = (
      <AuthForm
        variant="page"
        role={role}
        signupStep={Math.min(step, 2) as 0 | 1 | 2}
        onSignupStep={(n) => {
          if (n > 0) reach(n);
          go(n, n > step ? 'push' : 'replace');
        }}
        onVerified={() => advance(3)}
        onDone={(m) => {
          if (afterSignIn(m)) return true;
          navigate(next, { replace: true });
          return undefined;
        }}
        initialError={initialError}
      />
    );
  }

  return (
    <div className="auth-page landing-backdrop">
      <main id="main" tabIndex={-1} className="auth-shell">
        <aside className="auth-shell__aside">
          {/* Both photos stay mounted and cross-fade with the role toggle. */}
          {/* Lazy: below 860px this panel is display:none, so the browser never fetches them there. Intrinsic sizes avoid layout shift. */}
          <img className={`auth-shell__photo${role === 'seeker' ? ' is-on' : ''}`} src={seekerPhoto} alt="" width={1400} height={1042} loading="lazy" decoding="async" />
          <img className={`auth-shell__photo${role === 'owner' ? ' is-on' : ''}`} src={ownerPhoto} alt="" width={1200} height={800} loading="lazy" decoding="async" />
          <Link to={backTo} className="auth-page__back">
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
          {/* Narrow screens only (the aside above is hidden there): back link and brand. */}
          <div className="auth-page__mobilebar">
            <Link to={backTo} className="auth-page__back">
              <ArrowLeft size={16} aria-hidden="true" />
              Kembali
            </Link>
            <Link to="/" className="auth-page__brand" aria-label="KoBo, ke beranda">
              <img src="/favicon.svg" alt="" width={28} height={28} />
              <span>
                Ko<span style={{ color: 'var(--primary)' }}>Bo</span>
              </span>
            </Link>
          </div>
          {/* The role is fixed once the code step is reached: the steps differ per role. */}
          <div className="kobo-segmented auth-page__role" data-role={role} role="group" aria-label="Masuk sebagai">
            <button type="button" aria-pressed={role === 'seeker'} disabled={step >= 2} onClick={() => setRole('seeker')}>Mahasiswa</button>
            <button type="button" aria-pressed={role === 'owner'} disabled={step >= 2} onClick={() => setRole('owner')}>Pemilik kos</button>
          </div>
          {inSignup && <Stepper steps={steps} current={step - 1} furthest={furthest - 1} onStepClick={(i) => go(i + 1)} />}
          {body}
        </section>
      </main>
    </div>
  );
};
