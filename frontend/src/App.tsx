import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { lazyWithReload } from './lib/lazyWithReload';
import { TRPCProvider, queryClient, trpcClient } from './lib/trpc';
import { AppProvider, useAppStore } from './store/AppContext';
import { StudentLayout } from './components/layout/StudentLayout';
import { OwnerLayout } from './components/layout/OwnerLayout';
import { OwnerGuard } from './components/layout/OwnerGuard';
import { AppErrorBoundary } from './components/ui/ErrorBoundary';
import { ToastContainer } from './components/ui/Toast';

// Home stays eagerly imported: it is the landing route, so splitting it would
// only add a Suspense flash in front of the LCP element.
import { Home } from './pages/Home';

/* Every other route is code-split.
   This keeps Leaflet (~45KB gz, reachable only from Search) and the whole
   owner workspace out of the initial bundle, which is what buys back the
   budget the lazy three.js hero chunk spends. */

// Student / tenant routes
const Search = lazyWithReload(() =>
  import('./pages/Search').then((m) => ({ default: m.Search }))
);
const Detail = lazyWithReload(() =>
  import('./pages/Detail').then((m) => ({ default: m.Detail }))
);
const Checkout = lazyWithReload(() =>
  import('./pages/Checkout').then((m) => ({ default: m.Checkout }))
);
const MyKos = lazyWithReload(() =>
  import('./pages/MyKos').then((m) => ({ default: m.MyKos }))
);
const Profile = lazyWithReload(() =>
  import('./pages/Profile').then((m) => ({ default: m.Profile }))
);
const OwnerProfile = lazyWithReload(() =>
  import('./pages/OwnerProfile').then((m) => ({ default: m.OwnerProfile }))
);
const OwnerLogin = lazyWithReload(() =>
  import('./pages/owner/OwnerLogin').then((m) => ({ default: m.OwnerLogin }))
);

const ResetPassword = lazyWithReload(() =>
  import('./pages/ResetPassword').then((m) => ({ default: m.ResetPassword }))
);
const VerifyEmail = lazyWithReload(() =>
  import('./pages/VerifyEmail').then((m) => ({ default: m.VerifyEmail }))
);
const Kuitansi = lazyWithReload(() =>
  import('./pages/Kuitansi').then((m) => ({ default: m.Kuitansi }))
);
const NotFound = lazyWithReload(() =>
  import('./pages/NotFound').then((m) => ({ default: m.NotFound }))
);
const Contact = lazyWithReload(() =>
  import('./pages/Contact').then((m) => ({ default: m.Contact }))
);
const Terms = lazyWithReload(() =>
  import('./pages/Terms').then((m) => ({ default: m.Terms }))
);
const Privacy = lazyWithReload(() =>
  import('./pages/Privacy').then((m) => ({ default: m.Privacy }))
);

// Teman Sekamar (roommate matching)
const MatchDiscover = lazyWithReload(() =>
  import('./pages/matching/Discover').then((m) => ({ default: m.Discover }))
);
const MatchDetail = lazyWithReload(() =>
  import('./pages/matching/Detail').then((m) => ({ default: m.Detail }))
);
const MatchProfileForm = lazyWithReload(() =>
  import('./pages/matching/ProfileForm').then((m) => ({ default: m.ProfileForm }))
);
const MatchRequests = lazyWithReload(() =>
  import('./pages/matching/Requests').then((m) => ({ default: m.Requests }))
);
const MatchMessages = lazyWithReload(() =>
  import('./pages/matching/Messages').then((m) => ({ default: m.Messages }))
);
const MatchKosTogether = lazyWithReload(() =>
  import('./pages/matching/KosTogether').then((m) => ({ default: m.KosTogether }))
);
const MatchSettings = lazyWithReload(() =>
  import('./pages/matching/Settings').then((m) => ({ default: m.Settings }))
);

// The one sign-in / register page. `openAuthModal` redirects here (see AuthRedirect).
const AuthPage = lazyWithReload(() =>
  import('./pages/AuthPage').then((m) => ({ default: m.AuthPage }))
);

// Owner workspace routes
const OwnerDashboard = lazyWithReload(() =>
  import('./pages/owner/Dashboard').then((m) => ({ default: m.OwnerDashboard }))
);
const KosManager = lazyWithReload(() =>
  import('./pages/owner/KosManager').then((m) => ({ default: m.KosManager }))
);
const ReviewsManager = lazyWithReload(() =>
  import('./pages/owner/ReviewsManager').then((m) => ({ default: m.ReviewsManager }))
);

/**
 * Route-level loading fallback. Reserves vertical space so the header and
 * footer do not jump while a route chunk streams in.
 */
const RouteFallback: React.FC = () => (
  <div
    className="app-container"
    style={{
      minHeight: '60vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: '3rem',
      paddingBottom: '3rem',
    }}
    role="status"
    aria-live="polite"
  >
    <span style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>Memuat halaman…</span>
  </div>
);

/* Links and form submits push a new history entry: start that page at the top. Back/forward (POP) keeps the
   browser's own scroll position, and a #hash link is left alone so in-page anchors still land on their section. */
const ScrollToTop: React.FC = () => {
  const { pathname, search, hash } = useLocation();
  const navigationType = useNavigationType();
  const previousPath = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    if (navigationType === 'POP' || hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, search, hash, navigationType]);

  /* A new page after a link click: move focus into it (WCAG 2.4.3), otherwise it stays on the link that was
     clicked (often in the footer) or falls to <body>. Same-path changes (?query, #hash), back/forward and the
     first load leave focus alone; a field the page focused itself (autofocus) wins. The layout may still be
     lazy-loading, so look for the target for a short while. */
  React.useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname;
    if (previous === null || previous === pathname || navigationType === 'POP' || hash) return;
    let frames = 0;
    let raf = 0;
    const move = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && active.closest('main')) return;
      const target = document.getElementById('main') ?? document.querySelector<HTMLElement>('h1');
      if (!target) {
        if (++frames < 90) raf = requestAnimationFrame(move);
        return;
      }
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    raf = requestAnimationFrame(move);
    return () => cancelAnimationFrame(raf);
  }, [pathname, navigationType, hash]);
  return null;
};

/* `openAuthModal` (gated actions, route guards) no longer opens a dialog: it sends the visitor to /masuk and
   back through ?next. The store flag is kept so the many callers stay unchanged. */
const AuthRedirect: React.FC = () => {
  const { authModalOpen, closeAuthModal } = useAppStore();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  React.useEffect(() => {
    if (!authModalOpen) return;
    closeAuthModal();
    if (pathname === '/masuk') return;
    navigate(`/masuk?next=${encodeURIComponent(pathname + search + hash)}`);
  }, [authModalOpen, closeAuthModal, pathname, search, hash, navigate]);
  return null;
};

const RouteErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  return <AppErrorBoundary key={pathname}>{children}</AppErrorBoundary>;
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
    <AppProvider>
      <BrowserRouter>
        <a
          href="#main"
          className="skip-link"
          onClick={(e) => {
            // Chromium does not always focus a fragment target; move focus explicitly so the next Tab starts inside main.
            const main = document.getElementById('main');
            if (main) { e.preventDefault(); main.focus(); }
          }}
        >
          Lewati ke konten utama
        </a>
        <ScrollToTop />
        <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* Tenant / Student Portal Route Tree */}
              <Route element={<StudentLayout />}>
                <Route path="/" element={<Home />} />
                <Route path="/search" element={<Search />} />
                <Route path="/kos/:id" element={<Detail />} />
                <Route path="/checkout/:id" element={<Checkout />} />
                <Route path="/my-kos" element={<MyKos />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/kuitansi/:receiptNo" element={<Kuitansi />} />
                <Route path="/teman-sekamar" element={<MatchDiscover />} />
                <Route path="/teman-sekamar/profil" element={<MatchProfileForm />} />
                <Route path="/teman-sekamar/p/:id" element={<MatchDetail />} />
                <Route path="/teman-sekamar/permintaan" element={<MatchRequests />} />
                <Route path="/teman-sekamar/pesan" element={<MatchMessages />} />
                <Route path="/teman-sekamar/pesan/:connectionId" element={<MatchMessages />} />
                <Route path="/teman-sekamar/kos/:connectionId" element={<MatchKosTogether />} />
                <Route path="/teman-sekamar/pengaturan" element={<MatchSettings />} />
                <Route path="/owner/:id" element={<OwnerProfile />} />
                <Route path="/owner/login" element={<OwnerLogin />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/verifikasi-email" element={<VerifyEmail />} />
                <Route path="/kontak" element={<Contact />} />
                <Route path="/syarat" element={<Terms />} />
                <Route path="/privasi" element={<Privacy />} />
                <Route path="*" element={<NotFound />} />
              </Route>

              <Route path="/masuk" element={<AuthPage />} />

              {/* Owner SaaS Workspace Route Tree */}
              <Route element={<OwnerGuard />}>
                <Route element={<OwnerLayout />}>
                  <Route path="/owner/dashboard" element={<OwnerDashboard />} />
                  <Route path="/owner/kos" element={<KosManager />} />
                  <Route path="/owner/reviews" element={<ReviewsManager />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </RouteErrorBoundary>

        <AuthRedirect />
        <ToastContainer />
      </BrowserRouter>
    </AppProvider>
    </TRPCProvider>
    </QueryClientProvider>
  );
}

export default App;
