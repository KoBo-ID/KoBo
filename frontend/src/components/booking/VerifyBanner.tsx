import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GraduationCap, X } from 'lucide-react';
import { useSession } from '../../lib/session';
import { useNeedsVerification } from './VerifyPrompt';

const KEY = 'kobo.verifyBannerDismissed';
const readDismissed = () => {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
};

/** Thin banner for signed-in, non-owner, non-demo, unverified students. Dismissal lasts the browser session. */
export const VerifyBanner: React.FC = () => {
  const { me } = useSession();
  const needs = useNeedsVerification();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(readDismissed);
  // The profile page already is the verification form, and /masuk is a form of its own.
  if (!needs || dismissed || pathname.startsWith('/profile') || pathname.startsWith('/masuk')) return null;
  const pending = me?.studentVerification.state === 'PENDING';
  const rejected = me?.studentVerification.state === 'REJECTED';
  const dismiss = () => {
    try { sessionStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ }
    setDismissed(true);
  };
  return (
    <div role="region" aria-label="Verifikasi mahasiswa" data-testid="verify-banner" className="verify-banner">
      <GraduationCap size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span className="verify-banner__text">
        {pending ? 'KTM Anda sedang diperiksa. Anda bisa menyewa setelah verifikasi selesai.' : rejected ? 'KTM Anda ditolak. Lihat alasannya dan unggah ulang.' : 'Verifikasi status mahasiswa untuk bisa menyewa'}
        {' '}
        <Link to="/profile/verifikasi#verifikasi" className="verify-banner__link">{pending ? 'Lihat status' : rejected ? 'Perbaiki' : 'Verifikasi'}</Link>
      </span>
      <button type="button" className="verify-banner__close" aria-label="Tutup pengingat verifikasi" onClick={dismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
};
