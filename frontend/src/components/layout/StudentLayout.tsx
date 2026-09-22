import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { MobileNav } from './MobileNav';
import { AuthModal } from '../../pages/AuthModal';
import { BackButton } from '../ui/BackButton';

export const StudentLayout: React.FC = () => {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const location = useLocation();
  const showBackButton = location.pathname !== '/';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar onOpenAuth={() => setAuthModalOpen(true)} />
      <main style={{ flex: 1 }}>
        {showBackButton && (
          <div className="app-container" style={{ paddingTop: '1rem' }}>
            <BackButton />
          </div>
        )}
        <Outlet />
      </main>
      <Footer />
      <MobileNav />

      {/* Global Student Auth Modal */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
};
