import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { GraduationCap, CheckCircle2, ShieldCheck, Mail, MailCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { useAppStore } from '../../store/AppContext';
import { useSession } from '../../lib/session';
import { messageForError } from '../../lib/errors';

interface CampusDiscountCardProps {
  studentDiscountAmount: number;
  /** Checkout shows status and links to /profile; the profile page holds the actual form. */
  compact?: boolean;
}

const formatRupiah = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

/**
 * Student discount via campus-email verification (spec section 5): the student submits a *.ac.id address, we
 * email a signed link, and clicking it verifies. Status comes from auth.me (`campusVerified`); the link lands
 * back on /profile?campus=verified|invalid. Demo students are pre-verified, so they only ever see the status.
 */
export const CampusDiscountCard: React.FC<CampusDiscountCardProps> = ({ studentDiscountAmount, compact = false }) => {
  const { me } = useSession();
  const { openAuthModal } = useAppStore();
  const [params] = useSearchParams();
  const verified = !!me?.campusVerified;
  const invalidLink = !compact && params.get('campus') === 'invalid';

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Plain fetch: the better-auth client chunk is not needed for a single POST.
      const res = await fetch('/api/auth/campus-email/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setSentTo(email.trim().toLowerCase());
      } else {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setError(messageForError({ status: res.status, code: body.code }));
      }
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (!me) {
    body = (
      <div style={panel}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Masuk untuk memverifikasi email kampus Anda.</span>
        <Button size="sm" variant="primary" onClick={openAuthModal}>
          Masuk
        </Button>
      </div>
    );
  } else if (verified) {
    body = (
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ ...iconBox, backgroundColor: 'var(--primary-light)', color: 'var(--primary)', width: '32px', height: '32px' }}>
            <ShieldCheck size={18} />
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', display: 'block' }}>
              Email kampus terverifikasi{me.user.campusEmail ? ` (${me.user.campusEmail})` : ''}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
              Potongan sewa sebesar {formatRupiah(studentDiscountAmount)} / bulan diterapkan otomatis.
            </span>
          </div>
        </div>
      </div>
    );
  } else if (compact) {
    body = (
      <div style={panel}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Verifikasi email kampus (.ac.id) untuk mengaktifkan diskon.</span>
        <Link to="/profile">
          <Button size="sm" variant="primary">
            Verifikasi
          </Button>
        </Link>
      </div>
    );
  } else if (me.user.isDemo) {
    body = (
      <div style={panel}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Akun demo hanya-baca; verifikasi email kampus tidak tersedia.</span>
      </div>
    );
  } else if (sentTo) {
    body = (
      <div style={{ ...panel, alignItems: 'flex-start' }}>
        <MailCheck size={20} color="var(--primary)" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
        <div style={{ flex: 1 }}>
          <span role="status" style={{ fontSize: '0.85rem', fontWeight: 700, display: 'block' }}>
            Tautan verifikasi terkirim ke {sentTo}
          </span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Buka email tersebut dan klik tautannya (berlaku 24 jam). Periksa folder spam bila belum masuk.
          </span>
          <div style={{ marginTop: '0.5rem' }}>
            <button type="button" onClick={() => setSentTo(null)} style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textDecoration: 'underline' }}>
              Gunakan email lain / kirim ulang
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <form onSubmit={submit} style={{ ...panel, flexDirection: 'column', alignItems: 'stretch', gap: '0.75rem' }}>
        {invalidLink && <Notice tone="error">Tautan verifikasi tidak valid atau sudah kedaluwarsa. Kirim ulang di bawah.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <Input
          label="Email Kampus"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nama@student.binus.ac.id"
          helperText="Harus berakhiran .ac.id."
          iconLeft={<Mail size={16} />}
          autoComplete="email"
          required
        />
        <Button type="submit" variant="primary" size="sm" isLoading={busy} disabled={busy} style={{ alignSelf: 'flex-end' }}>
          Kirim Tautan Verifikasi
        </Button>
      </form>
    );
  }

  return (
    <div
      style={{
        backgroundColor: verified ? 'var(--primary-light)' : 'var(--bg-page)',
        border: `1.5px solid ${verified ? 'var(--primary)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '1.25rem',
        transition: 'all var(--duration-fast) var(--ease-out-spring)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div
            style={{
              ...iconBox,
              width: '40px',
              height: '40px',
              backgroundColor: verified ? 'var(--primary)' : 'var(--bg-muted)',
              color: verified ? 'white' : 'var(--text-muted)',
            }}
          >
            <GraduationCap size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>Diskon Mahasiswa Indo</h4>
              <span
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'white',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  padding: '0.15rem 0.5rem',
                  borderRadius: 'var(--radius-badge)',
                }}
              >
                HEMAT {formatRupiah(studentDiscountAmount)}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              Verifikasi email kampus (.ac.id) Anda sekali untuk klaim potongan harga sewa. Tanpa unggah dokumen.
            </p>
          </div>
        </div>

        {verified && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--primary)', fontSize: '0.785rem', fontWeight: 700, flexShrink: 0 }}>
            <CheckCircle2 size={16} />
            <span>Aktif</span>
          </div>
        )}
      </div>

      {body}
    </div>
  );
};

const iconBox: React.CSSProperties = {
  borderRadius: 'var(--radius-md)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const panel: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: '0.85rem 1rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
};
