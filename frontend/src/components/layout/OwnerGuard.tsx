import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { justSignedOut, useSession } from '../../lib/session';

/**
 * Gate for the owner workspace. Persona is derived from the session: only a user with an OwnerProfile gets
 * through. A visitor without a session goes to the owner side of /masuk and comes back afterwards; a signed-in
 * non-owner goes to the owner sign-up page; right after an explicit sign-out the guard only goes home.
 * (The server enforces ownership too; this guard is only the UX half.)
 */
export const OwnerGuard: React.FC = () => {
  const { me, isLoading } = useSession();
  const { pathname, search } = useLocation();

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Memeriksa sesi…</span>
      </div>
    );
  }
  if (me?.isOwner) return <Outlet />;
  if (me) return <Navigate to="/owner/login" replace />;
  if (justSignedOut()) return <Navigate to="/" replace />;
  return <Navigate to={`/masuk?peran=pemilik&next=${encodeURIComponent(pathname + search)}`} replace />;
};
