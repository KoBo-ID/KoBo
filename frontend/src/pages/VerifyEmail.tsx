import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { AuthCard } from '../components/auth/AuthCard';
import { VerifyCodeStep } from '../components/auth/VerifyCodeStep';
import { ButtonLink } from '../components/ui/Button';
import { useAuthActions } from '../lib/session';
import { useAppStore } from '../store/AppContext';
import { safeNext } from '../lib/safeNext';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** /verifikasi-email?email=...: the 6-digit code step. Without an email there is nothing to verify, so it points to sign-in. */
export const VerifyEmail: React.FC = () => {
  useDocumentTitle('Verifikasi email');
  const [params] = useSearchParams();
  const email = params.get('email')?.trim() ?? '';
  const { refreshSession } = useAuthActions();
  const { addToast } = useAppStore();
  const navigate = useNavigate();

  if (!email) {
    return (
      <AuthCard icon={<MailCheck size={40} color="var(--primary)" />} title="Verifikasi email">
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Verifikasi email memakai kode 6 digit yang dikirim saat Anda mendaftar atau masuk. Masuk untuk menerima kode baru.
        </p>
        <ButtonLink to="/masuk" variant="primary" fullWidth>
          Ke Halaman Masuk
        </ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard icon={null} title="Verifikasi email">
      <VerifyCodeStep
        email={email}
        onBack={() => navigate('/masuk')}
        onVerified={async () => {
          await refreshSession();
          addToast('Email terverifikasi. Selamat datang di KoBo!', 'success');
          navigate(safeNext(params.get('next')), { replace: true });
        }}
      />
    </AuthCard>
  );
};
