import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { lazyWithReload } from './lib/lazyWithReload';
import { TRPCProvider, queryClient, trpcClient } from './lib/trpc';
import { AppProvider, useAppStore } from './store/AppContext';
import { StudentLayout } from './components/layout/StudentLayout';
import { OwnerLayout } from './components/layout/OwnerLayout';
import { OwnerGuard } from './components/layout/OwnerGuard';
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

// The sign-in dialog (and, further down the chain, the better-auth client) loads on first open.
const AuthModal = lazyWithReload(() =>
  import('./pages/AuthModal').then((m) => ({ default: m.AuthModal }))
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
    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Memuat halaman…</span>
  </div>
);

/* Links and form submits push a new history entry: start that page at the top. Back/forward (POP) keeps the
   browser's own scroll position, and a #hash link is left alone so in-page anchors still land on their section. */
const ScrollToTop: React.FC = () => {
  const { pathname, search, hash } = useLocation();
  const navigationType = useNavigationType();
  React.useLayoutEffect(() => {
    if (navigationType === 'POP' || hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, search, hash, navigationType]);
  return null;
};

const AuthModalHost: React.FC = () => {
  const { authModalOpen, closeAuthModal } = useAppStore();
  if (!authModalOpen) return null;
  return (
    <Suspense fallback={null}>
      <AuthModal isOpen onClose={closeAuthModal} />
    </Suspense>
  );
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
    <AppProvider>
      <BrowserRouter>
        <ScrollToTop />
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
              <Route path="/owner/:id" element={<OwnerProfile />} />
              <Route path="/owner/login" element={<OwnerLogin />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/verifikasi-email" element={<VerifyEmail />} />
              <Route path="*" element={<NotFound />} />
            </Route>

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

        <AuthModalHost />
        <ToastContainer />
      </BrowserRouter>
    </AppProvider>
    </TRPCProvider>
    </QueryClientProvider>
  );
}

export default App;
