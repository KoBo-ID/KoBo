import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Lock, ShieldAlert } from 'lucide-react';
import { AuthCard } from '../components/auth/AuthCard';
import { EmailActionForm } from '../components/auth/EmailActionForm';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { useAuthActions } from '../lib/session';
import { messageForError } from '../lib/errors';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { safeNext } from '../lib/safeNext';
import { useAppStore } from '../store/AppContext';

/** Landing page of the emailed reset link: /reset-password?token=... (or ?error=INVALID_TOKEN). */
export const ResetPassword: React.FC = () => {
  useDocumentTitle('Atur ulang kata sandi');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const linkError = params.get('error');
  const { refreshSession } = useAuthActions();
  const { addToast } = useAppStore();
  // `next` rides the emailed link (SIM-022); it always goes through safeNext.
  const nextRaw = params.get('next');
  const next = nextRaw ? safeNext(nextRaw) : null;
  const nextQuery = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Kata sandi minimal 8 karakter.');
    if (password !== confirm) return setError('Konfirmasi kata sandi tidak sama.');
    setBusy(true);
    try {
      const { authClient } = await import('../lib/authClient');
      const { error: err } = await authClient.resetPassword({ newPassword: password, token: token ?? '' });
      if (err) {
        setError(messageForError(err));
      } else {
        await refreshSession().catch(() => {});
        addToast('Kata sandi diperbarui. Silakan masuk.', 'success');
        navigate(`/masuk${nextQuery}`, { replace: true });
      }
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  };

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
            const { error: err } = await authClient.requestPasswordReset({ email, redirectTo: `/reset-password${nextQuery}` });
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
