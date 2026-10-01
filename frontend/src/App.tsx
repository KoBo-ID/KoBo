import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './store/AppContext';
import { StudentLayout } from './components/layout/StudentLayout';
import { OwnerLayout } from './components/layout/OwnerLayout';
import { ToastContainer } from './components/ui/Toast';

// Home stays eagerly imported: it is the landing route, so splitting it would
// only add a Suspense flash in front of the LCP element.
import { Home } from './pages/Home';

/* Every other route is code-split.
   This keeps Leaflet (~45KB gz, reachable only from Search) and the whole
   owner workspace out of the initial bundle, which is what buys back the
   budget the lazy three.js hero chunk spends. */

// Student / tenant routes
const Search = lazy(() =>
  import('./pages/Search').then((m) => ({ default: m.Search }))
);
const Detail = lazy(() =>
  import('./pages/Detail').then((m) => ({ default: m.Detail }))
);
const Checkout = lazy(() =>
  import('./pages/Checkout').then((m) => ({ default: m.Checkout }))
);
const MyKos = lazy(() =>
  import('./pages/MyKos').then((m) => ({ default: m.MyKos }))
);
const Profile = lazy(() =>
  import('./pages/Profile').then((m) => ({ default: m.Profile }))
);
const OwnerProfile = lazy(() =>
  import('./pages/OwnerProfile').then((m) => ({ default: m.OwnerProfile }))
);
const OwnerLogin = lazy(() =>
  import('./pages/owner/OwnerLogin').then((m) => ({ default: m.OwnerLogin }))
);

// Owner workspace routes
const OwnerDashboard = lazy(() =>
  import('./pages/owner/Dashboard').then((m) => ({ default: m.OwnerDashboard }))
);
const KosManager = lazy(() =>
  import('./pages/owner/KosManager').then((m) => ({ default: m.KosManager }))
);
const ReviewsManager = lazy(() =>
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

export function App() {
  return (
    <AppProvider>
      <BrowserRouter>
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
              <Route path="/owner/:id" element={<OwnerProfile />} />
              <Route path="/owner/login" element={<OwnerLogin />} />
            </Route>

            {/* Owner SaaS Workspace Route Tree */}
            <Route element={<OwnerLayout />}>
              <Route path="/owner/dashboard" element={<OwnerDashboard />} />
              <Route path="/owner/kos" element={<KosManager />} />
              <Route path="/owner/reviews" element={<ReviewsManager />} />
            </Route>
          </Routes>
        </Suspense>

        <ToastContainer />
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
