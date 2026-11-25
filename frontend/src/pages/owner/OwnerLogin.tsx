import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  LayoutDashboard,
  MessageCircle,
  FileText,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useAuthActions, useSession } from '../../lib/session';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

export const OwnerLogin: React.FC = () => {
  useDocumentTitle('Masuk pemilik');
  const navigate = useNavigate();
  const { me, isLoading } = useSession();
  const { logout } = useAuthActions();
  const isDemo = !!me?.user.isDemo;

  // One CTA, three meanings: sign in, open the workspace, or self-register as an owner.
  const ctaLabel = !me ? 'Masuk atau daftar sebagai pemilik' : me.isOwner ? 'Lanjut ke dasbor pemilik' : 'Daftarkan diri sebagai pemilik';
  const onCta = () => {
    if (!me) navigate('/masuk?peran=pemilik&next=%2Fowner%2Fdashboard');
    else if (me.isOwner) navigate('/owner/dashboard');
    else navigate('/masuk?peran=pemilik&langkah=3');
  };

  // The Demo Student cannot register as an owner: offer the way forward (sign out, then the owner side of the sign-in page).
  const switchToOwner = async () => {
    await logout();
    navigate('/masuk?peran=pemilik&next=%2Fowner%2Fdashboard');
  };

  const features = [
    { icon: <LayoutDashboard size={16} />, text: 'Papan okupansi dengan 5 status kamar' },
    { icon: <MessageCircle size={16} />, text: 'Tagihan WhatsApp sekali klik' },
    { icon: <FileText size={16} />, text: 'Kuitansi digital sekali klik' },
  ];

  return (
    <div className="app-container" style={{ paddingTop: '3rem', paddingBottom: '3rem' }}>
      {/* Top-anchored: the navbar and footer already frame the page, and a fixed
          top offset keeps the heading in the same place at 650px and 900px tall. */}
      <div style={{ width: '100%', maxWidth: '28rem', marginInline: 'auto' }}>
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-sm)',
            padding: 'clamp(1.5rem, 5vw, 2rem)',
          }}
        >
          <h1 style={{ fontSize: 'var(--step-2)', fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.25, marginBottom: '1.5rem' }}>
            Masuk ke Portal Pemilik Kos
          </h1>
          {/* Feature highlights */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              marginBottom: '1.5rem',
            }}
          >
            {features.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <span style={{ color: 'var(--primary)', flexShrink: 0 }}>{f.icon}</span>
                <span style={{ fontSize: 'var(--step--1)', fontWeight: 600, color: 'var(--text-main)' }}>
                  {f.text}
                </span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <Button
            id="owner-login-cta"
            variant="primary"
            size="lg"
            icon={<ArrowRight size={18} />}
            iconPosition="right"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={isLoading || (isDemo && !me?.isOwner)}
            onClick={onCta}
          >
            {ctaLabel}
          </Button>

          <p
            style={{
              fontSize: 'var(--step--1)',
              color: 'var(--text-muted)',
              marginTop: '1rem',
            }}
          >
            {isDemo && !me?.isOwner ? 'Akun ini tidak dapat didaftarkan. Masuk dengan akun Anda sendiri.' : 'Akun Anda tetap sama untuk mencari kos dan mengelola kos.'}
          </p>
          {isDemo && !me?.isOwner && (
            <Button id="owner-login-switch" variant="outline" style={{ width: '100%', justifyContent: 'center', marginTop: '0.75rem' }} onClick={() => void switchToOwner()}>
              Keluar dan masuk sebagai pemilik
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
