import React, { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MailCheck, ShieldAlert } from 'lucide-react';
import { AuthCard } from '../components/auth/AuthCard';
import { EmailActionForm } from '../components/auth/EmailActionForm';
import { Button } from '../components/ui/Button';
import { useAuthActions } from '../lib/session';

/** Landing page of the emailed verification link: /verifikasi-email (success) or ?error=... (failure). */
export const VerifyEmail: React.FC = () => {
  const [params] = useSearchParams();
  const failed = params.get('error');
  const { refreshSession } = useAuthActions();

  // A successful link signs the user in server-side (autoSignInAfterVerification); pick that up.
  useEffect(() => {
    if (!failed) void refreshSession();
  }, [failed, refreshSession]);

  if (!failed) {
    return (
      <AuthCard icon={<MailCheck size={40} color="var(--primary)" />} title="Email berhasil diverifikasi">
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>Akun KoBo Anda sudah aktif. Selamat mencari kos!</p>
        <Link to="/">
          <Button variant="primary" fullWidth>
            Ke Beranda
          </Button>
        </Link>
      </AuthCard>
    );
  }

  const expired = /expired/i.test(failed);
  return (
    <AuthCard icon={<ShieldAlert size={40} color="var(--status-overdue)" />} title="Verifikasi gagal">
      <p style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
        {expired ? 'Tautan verifikasi sudah kedaluwarsa.' : 'Tautan verifikasi tidak valid atau sudah dipakai.'} Minta tautan baru di bawah.
      </p>
      <EmailActionForm
        submitLabel="Kirim Ulang Email Verifikasi"
        successText="Tautan verifikasi baru sudah dikirim. Periksa kotak masuk dan folder spam Anda."
        send={async (email) => {
          const { authClient } = await import('../lib/authClient');
          const { error: err } = await authClient.sendVerificationEmail({ email, callbackURL: '/verifikasi-email' });
          return err ?? null;
        }}
      />
    </AuthCard>
  );
};
