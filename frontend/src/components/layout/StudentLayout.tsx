import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { MobileNav } from './MobileNav';
import { DemoNotice } from './DemoNotice';
import { useAppStore } from '../../store/AppContext';

export const StudentLayout: React.FC = () => {
  const { openAuthModal } = useAppStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar onOpenAuth={openAuthModal} />
      <DemoNotice />
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
};
