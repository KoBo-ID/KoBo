import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Lock, CheckCircle2, ShieldAlert } from 'lucide-react';
import { AuthCard } from '../components/auth/AuthCard';
import { EmailActionForm } from '../components/auth/EmailActionForm';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { useAppStore } from '../store/AppContext';
import { messageForError } from '../lib/errors';

/** Landing page of the emailed reset link: /reset-password?token=... (or ?error=INVALID_TOKEN). */
export const ResetPassword: React.FC = () => {
  const [params] = useSearchParams();
  const token = params.get('token');
  const linkError = params.get('error');
  const { openAuthModal } = useAppStore();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Kata sandi minimal 8 karakter.');
    if (password !== confirm) return setError('Konfirmasi kata sandi tidak sama.');
    setBusy(true);
    try {
      const { authClient } = await import('../lib/authClient');
      const { error: err } = await authClient.resetPassword({ newPassword: password, token: token ?? '' });
      if (err) setError(messageForError(err));
      else setDone(true);
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthCard icon={<CheckCircle2 size={40} color="var(--primary)" />} title="Kata sandi diperbarui">
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>Kata sandi baru Anda sudah aktif. Silakan masuk dengan kata sandi tersebut.</p>
        <Button variant="primary" fullWidth onClick={openAuthModal}>
          Masuk
        </Button>
      </AuthCard>
    );
  }

  if (!token || linkError) {
    return (
      <AuthCard icon={<ShieldAlert size={40} color="var(--status-overdue)" />} title="Tautan tidak valid">
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Tautan atur ulang kata sandi ini tidak valid atau sudah kedaluwarsa (berlaku satu jam). Minta tautan baru di bawah.
        </p>
        <EmailActionForm
          submitLabel="Kirim Tautan Baru"
          successText="Jika email terdaftar, tautan baru sudah kami kirim. Periksa kotak masuk Anda."
          send={async (email) => {
            const { authClient } = await import('../lib/authClient');
            const { error: err } = await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
            return err ?? null;
          }}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard icon={<KeyRound size={40} color="var(--primary)" />} title="Atur Ulang Kata Sandi">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && <Notice tone="error">{error}</Notice>}
        <Input
          label="Kata Sandi Baru"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Minimal 8 karakter"
          iconLeft={<Lock size={16} />}
          autoComplete="new-password"
          required
        />
        <Input
          label="Ulangi Kata Sandi Baru"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          iconLeft={<Lock size={16} />}
          autoComplete="new-password"
          required
        />
        <Button type="submit" variant="primary" fullWidth isLoading={busy} disabled={busy}>
          Simpan Kata Sandi Baru
        </Button>
      </form>
    </AuthCard>
  );
};
