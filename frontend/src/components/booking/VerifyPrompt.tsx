import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GraduationCap, Hourglass } from 'lucide-react';
import { useSession } from '../../lib/session';
import { safeNext } from '../../lib/safeNext';

/** True when a signed-in, non-demo user has no live student verification (the server is the enforcer; this only guides). */
export function useNeedsVerification(): boolean {
  const { me } = useSession();
  return !!me && me.studentVerificationRequired && !me.user.isDemo && !me.isOwner && !me.campusVerified;
}

/** `/profile?next=<this page>` so verifying brings the student back here. Never loops back to /profile itself. */
export function useVerifyLink(): string {
  const { pathname, search } = useLocation();
  const next = safeNext(`${pathname}${search}`, '/');
  return next === '/' || next.startsWith('/profile') ? '/profile' : `/profile?next=${encodeURIComponent(next)}`;
}

const submittedLabel = (iso: string) => `${new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB`;

/** One line for signed-out visitors next to the booking actions: the gate is explained before they hit it. */
export const StudentOnlyNote: React.FC = () => {
  const { me, isLoading } = useSession();
  if (me || isLoading) return null;
  return (
    <p data-testid="student-only-note" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>
      <GraduationCap size={16} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--primary)' }} />
      Sewa khusus mahasiswa terverifikasi
    </p>
  );
};

/** Banner above a form the server refuses to unverified students. Never replaces the form. */
export const VerifyPrompt: React.FC<{ what: string }> = ({ what }) => {
  const { me } = useSession();
  const needs = useNeedsVerification();
  const verifyLink = useVerifyLink();
  if (!needs) return null;
  const sv = me?.studentVerification;
  if (sv?.state === 'PENDING') {
    return (
      <div role="note" data-testid="verify-prompt" className="verify-prompt">
        <Hourglass size={20} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--primary)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 'var(--step--1)' }}>KTM sedang diperiksa</strong>
          <span style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>
            {sv.submittedAt ? `Dikirim ${submittedLabel(sv.submittedAt)}. ` : ''}{sv.slaText}. Anda bisa {what} setelah verifikasi selesai.{' '}
            <Link to="/search" style={{ color: 'var(--primary)', fontWeight: 700 }}>Lihat kos lain</Link>
          </span>
        </div>
      </div>
    );
  }
  return (
    <div role="note" data-testid="verify-prompt" className="verify-prompt">
      <GraduationCap size={20} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--primary)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: 'var(--step--1)' }}>Verifikasi status mahasiswa dulu</strong>
        <span style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>
          KoBo khusus mahasiswa. Verifikasi di halaman Profil sebelum {what}.{' '}
          <Link to={verifyLink} style={{ color: 'var(--primary)', fontWeight: 700 }}>Verifikasi sekarang</Link>
        </span>
      </div>
    </div>
  );
};
