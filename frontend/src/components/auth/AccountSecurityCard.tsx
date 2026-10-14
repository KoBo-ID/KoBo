import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { messageForError } from '../../lib/errors';
import { useAppStore } from '../../store/AppContext';

/**
 * Change password for a signed-in, non-demo account. Other devices are signed out on success. Changing the email
 * or deleting the account is deliberately not offered here: both touch payment and receipt history that must be kept.
 */
export const AccountSecurityCard: React.FC = () => {
  const { addToast } = useAppStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = !pending && current.length > 0 && next.length >= 8 && confirm === next && next !== current;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const { authClient } = await import('../../lib/authClient');
      const res = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
      if (res.error) throw res.error;
      setCurrent('');
      setNext('');
      setConfirm('');
      addToast('Kata sandi diubah. Perangkat lain telah dikeluarkan.', 'success');
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-labelledby="account-security-title"
      style={{ backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <KeyRound size={18} color="var(--primary)" />
        <h2 id="account-security-title" style={{ fontSize: '1rem', fontWeight: 700 }}>Keamanan akun</h2>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Input label="Kata sandi saat ini" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Input
        label="Kata sandi baru"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        error={tooShort ? 'Minimal 8 karakter.' : next && next === current ? 'Harus berbeda dari kata sandi saat ini.' : undefined}
      />
      <Input label="Ulangi kata sandi baru" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={mismatch ? 'Tidak sama dengan kata sandi baru.' : undefined} />
      <div>
        <Button type="submit" variant="primary" size="sm" isLoading={pending} disabled={!canSubmit}>
          Ubah Kata Sandi
        </Button>
      </div>
    </form>
  );
};
