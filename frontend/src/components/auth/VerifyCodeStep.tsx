import React, { useEffect, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import { OtpInput } from '../ui/OtpInput';
import { Notice } from '../ui/Notice';
import { messageForError } from '../../lib/errors';

const RESEND_SECONDS = 60;

/** Plain fetch: the verification endpoints need no better-auth client, so nothing extra joins any chunk. */
async function postAuth(path: string, body: object): Promise<unknown | null> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { code?: string };
    return { status: res.status, code: data.code };
  } catch (err) {
    return err;
  }
}

interface VerifyCodeStepProps {
  email: string;
  /** Called after the server accepted the code (the session cookie is already set). */
  onVerified: () => void | Promise<void>;
  /** Optional escape hatch, e.g. back to the sign-in form. */
  onBack?: () => void;
  backLabel?: string;
}

/** The 6-digit code step shared by sign-up, unverified sign-in and /verifikasi-email?email=. */
export const VerifyCodeStep: React.FC<VerifyCodeStepProps> = ({ email, onVerified, onBack, backLabel = 'Kembali ke Masuk' }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'verify' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A fresh code was just queued by sign-up or the refused sign-in, so the countdown starts immediately.
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy('verify');
    setError(null);
    setNotice(null);
    const err = await postAuth('/api/auth/email-otp/verify-email', { email, otp: code });
    if (err) {
      setError(messageForError(err));
      setBusy(null);
      return;
    }
    try {
      await onVerified();
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setBusy('resend');
    setError(null);
    setNotice(null);
    const err = await postAuth('/api/auth/email-otp/send-verification-otp', { email, type: 'email-verification' });
    if (err) setError(messageForError(err));
    else {
      setNotice('Kode baru dikirim. Periksa kotak masuk dan folder spam Anda.');
      setCode('');
      setWait(RESEND_SECONDS);
    }
    setBusy(null);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="verify-code" noValidate>
      <MailCheck size={40} color="var(--primary)" />
      <p className="verify-code__text">
        Masukkan kode 6 digit yang kami kirim ke <strong>{email}</strong>. Berlaku 10 menit.
      </p>
      <div className="verify-code__stack">
        {error && <Notice tone="error">{error}</Notice>}
        {notice && <Notice tone="success">{notice}</Notice>}
        <OtpInput label="Kode verifikasi" value={code} onChange={setCode} autoFocus />
      </div>
      <div className="verify-code__stack">
        <Button type="submit" variant="primary" fullWidth isLoading={busy === 'verify'} disabled={code.length !== 6 || busy !== null}>
          Verifikasi
        </Button>
        <Button type="button" variant="outline" fullWidth isLoading={busy === 'resend'} disabled={wait > 0 || busy !== null} onClick={() => void resend()}>
          {wait > 0 ? `Kirim ulang kode (${wait} dtk)` : 'Kirim ulang kode'}
        </Button>
        {onBack && (
          <button type="button" className="verify-code__back" onClick={onBack}>
            {backLabel}
          </button>
        )}
      </div>
    </form>
  );
};
