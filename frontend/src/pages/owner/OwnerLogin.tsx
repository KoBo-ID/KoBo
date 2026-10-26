import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  LayoutDashboard,
  MessageCircle,
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
  const ctaLabel = !me ? 'Masuk untuk mendaftar' : me.isOwner ? 'Lanjut ke dasbor pemilik' : 'Daftarkan diri sebagai pemilik';
  const onCta = () => {
    if (!me) openAuthModal();
    else if (me.isOwner) navigate('/owner/dashboard');
    else void becomeOwner();
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
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.25, marginBottom: '1.5rem' }}>
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
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
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
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
              marginTop: '1rem',
            }}
          >
            {isDemo && !me?.isOwner ? 'Akun ini tidak dapat didaftarkan. Masuk dengan akun Anda sendiri.' : 'Akun Anda tetap sama untuk mencari kos dan mengelola kos.'}
          </p>
        </div>
      </div>
    </div>
  );
};
