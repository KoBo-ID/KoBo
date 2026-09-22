import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './store/AppContext';
import { StudentLayout } from './components/layout/StudentLayout';
import { OwnerLayout } from './components/layout/OwnerLayout';
import { ToastContainer } from './components/ui/Toast';

// Student Pages
import { Home } from './pages/Home';
import { Search } from './pages/Search';
import { Detail } from './pages/Detail';
import { Checkout } from './pages/Checkout';
import { MyKos } from './pages/MyKos';
import { Profile } from './pages/Profile';
import { OwnerProfile } from './pages/OwnerProfile';
import { OwnerLogin } from './pages/owner/OwnerLogin';

// Owner Pages
import { OwnerDashboard } from './pages/owner/Dashboard';
import { KosManager } from './pages/owner/KosManager';
import { ReviewsManager } from './pages/owner/ReviewsManager';

export function App() {
  return (
    <AppProvider>
      <BrowserRouter>
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

        <ToastContainer />
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
