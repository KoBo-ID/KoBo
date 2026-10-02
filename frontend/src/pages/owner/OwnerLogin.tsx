import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  LayoutDashboard,
  Users,
  FileText,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Notice';
import { useSession } from '../../lib/session';
import { useBecomeOwner } from '../../lib/owner';
import { useAppStore } from '../../store/AppContext';

export const OwnerLogin: React.FC = () => {
  const navigate = useNavigate();
  const { me, isLoading } = useSession();
  const { openAuthModal } = useAppStore();
  const { becomeOwner, isPending, error } = useBecomeOwner();
  const isDemo = !!me?.user.isDemo;

  // One CTA, three meanings: sign in, open the workspace, or self-register as an owner.
  const ctaLabel = !me ? 'Masuk untuk Mendaftar sebagai Pemilik' : me.isOwner ? 'Lanjut ke Dashboard Pemilik' : 'Daftarkan diri sebagai pemilik';
  const onCta = () => {
    if (!me) openAuthModal();
    else if (me.isOwner) navigate('/owner/dashboard');
    else void becomeOwner();
  };

  const features = [
    { icon: <LayoutDashboard size={16} />, text: 'Papan Okupansi 5 Status Kamar' },
    { icon: <Users size={16} />, text: 'Pengingat Tagihan WhatsApp Otomatis' },
    { icon: <FileText size={16} />, text: 'Kuitansi Resmi Digital 1 Klik' },
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(110% 120% at 50% 0%, hsla(176, 55%, 94%, 0.9) 0%, var(--bg-page) 65%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.25rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: '480px' }}>
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '56px',
              height: '56px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--primary)',
              color: 'white',
              boxShadow: '0 8px 24px -4px var(--primary-glow)',
              marginBottom: '1rem',
            }}
          >
            <Building2 size={28} />
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.025em', marginBottom: '0.25rem' }}>
            Ko<span style={{ color: 'var(--primary)' }}>Bo</span> <span style={{ color: 'var(--primary)' }}>Mitra</span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            Portal Pengelola Kos
          </p>
        </div>

        {/* Login Card */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-xl)',
            padding: '2.5rem',
          }}
        >
          {/* Restricted Access Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: 'var(--primary-light)',
              color: 'var(--primary)',
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '0.3rem 0.75rem',
              borderRadius: 'var(--radius-badge)',
              border: '1px solid hsla(176, 75%, 28%, 0.15)',
              marginBottom: '1.25rem',
            }}
          >
            <ShieldCheck size={14} />
            <span>Gratis untuk Pemilik Properti Kos</span>
          </div>

          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.025em', marginBottom: '0.5rem' }}>
            Masuk ke Portal Pemilik Kos
          </h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '2rem' }}>
            Daftarkan akun Anda sebagai pemilik, lalu kelola kamar, tagihan, dan kuitansi kos Anda dari satu dashboard. Gratis.
          </p>

          {/* Feature highlights */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
              marginBottom: '2rem',
              padding: '1.25rem',
              backgroundColor: 'var(--primary-subtle)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--primary-light)',
            }}
          >
            {features.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <span style={{ color: 'var(--primary)', flexShrink: 0 }}>{f.icon}</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
                  {f.text}
                </span>
                <CheckCircle2 size={14} color="var(--primary)" style={{ marginLeft: 'auto', flexShrink: 0 }} />
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
            isLoading={isPending}
            disabled={isLoading || isPending || (isDemo && !me?.isOwner)}
            onClick={onCta}
          >
            {ctaLabel}
          </Button>
          {error && (
            <div style={{ marginTop: '1rem' }}>
              <Notice tone="error">{error}</Notice>
            </div>
          )}

          <p
            style={{
              textAlign: 'center',
              fontSize: '0.75rem',
              color: 'var(--text-subtle)',
              marginTop: '1rem',
            }}
          >
            {isDemo && !me?.isOwner ? 'Akun demo tidak dapat didaftarkan. Masuk dengan akun Anda sendiri.' : 'Akun Anda tetap sama untuk mencari kos dan mengelola kos.'}
          </p>
        </div>

      </div>
    </div>
  );
};
