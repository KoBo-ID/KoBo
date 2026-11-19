import React from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useSession } from '../../lib/session';

/** True when a signed-in, non-demo user has no live student verification (the server is the enforcer; this only guides). */
export function useNeedsVerification(): boolean {
  const { me } = useSession();
  return !!me && me.studentVerificationRequired && !me.user.isDemo && !me.isOwner && !me.campusVerified;
}

/** Banner above a form the server refuses to unverified students. Never replaces the form. */
export const VerifyPrompt: React.FC<{ what: string }> = ({ what }) => {
  if (!useNeedsVerification()) return null;
  return (
    <div role="note" data-testid="verify-prompt" className="verify-prompt">
      <GraduationCap size={20} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--primary)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: 'var(--step--1)' }}>Verifikasi status mahasiswa dulu</strong>
        <span style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>
          KoBo khusus mahasiswa. Verifikasi di halaman Profil sebelum {what}.{' '}
          <Link to="/profile" style={{ color: 'var(--primary)', fontWeight: 700 }}>Verifikasi sekarang</Link>
        </span>
      </div>
    </div>
  );
};
