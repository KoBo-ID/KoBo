import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { MobileNav } from './MobileNav';
import { AuthModal } from '../../pages/AuthModal';

export const StudentLayout: React.FC = () => {
  const [authModalOpen, setAuthModalOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar onOpenAuth={() => setAuthModalOpen(true)} />
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
      <Footer />
      <MobileNav />

      {/* Global Student Auth Modal */}
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
    </div>
  );
};
