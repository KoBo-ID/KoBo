import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { messageForError } from '../../lib/errors';

/** Email field plus a button that fires one auth-client call (resend verification, request a reset link). */
export const EmailActionForm: React.FC<{
  submitLabel: string;
  successText: string;
  /** Resolves to an auth-client error to show, or null on success. */
  send: (email: string) => Promise<unknown>;
}> = ({ submitLabel, successText, send }) => {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const err = await send(email.trim());
      if (err) setError(messageForError(err));
      else setDone(true);
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {error && <Notice tone="error">{error}</Notice>}
      {done && <Notice tone="success">{successText}</Notice>}
      <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@email.com" iconLeft={<Mail size={16} />} autoComplete="email" required />
      <Button type="submit" variant="primary" fullWidth isLoading={busy} disabled={busy}>
        {submitLabel}
      </Button>
    </form>
  );
};
