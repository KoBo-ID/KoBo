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
      {/* Above the sticky header, in normal flow. The home/auth glow (.landing-backdrop) extends one header-height
          upward to sit under the transparent header; with the banner below the header that extension would paint
          over (and swallow clicks on) the banner. Above the header, the extension covers only the header. */}
      <VerifyBanner />
      <Navbar onOpenAuth={openAuthModal} />
      {/* min-height is one screen minus the navbar (see my-kos.css), so the footer starts at the fold. */}
      <main id="main" tabIndex={-1} className="student-main">
        <Outlet />
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
};
