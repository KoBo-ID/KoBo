import React, { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { useAppStore } from '../../store/AppContext';

/**
 * Gate for the owner workspace. Persona is derived from the session: only a user with an OwnerProfile gets
 * through. Everyone else goes home and the sign-in dialog opens. (The server enforces ownership too;
 * this guard is only the UX half.)
 */
export const OwnerGuard: React.FC = () => {
  const { me, isLoading } = useSession();
  const { openAuthModal } = useAppStore();
  const allowed = !!me?.isOwner;

  useEffect(() => {
    if (!isLoading && !allowed) openAuthModal();
  }, [isLoading, allowed, openAuthModal]);

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Memeriksa sesi…</span>
      </div>
    );
  }
  return allowed ? <Outlet /> : <Navigate to="/" replace />;
};
