import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { MobileNav } from './MobileNav';
import { VerifyBanner } from '../booking/VerifyBanner';
import { useAppStore } from '../../store/AppContext';

export const StudentLayout: React.FC = () => {
  const { openAuthModal } = useAppStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar onOpenAuth={openAuthModal} />
      <VerifyBanner />
      {/* min-height is one screen minus the navbar (see my-kos.css), so the footer starts at the fold. */}
      <main id="main" tabIndex={-1} className="student-main">
        <Outlet />
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
};
