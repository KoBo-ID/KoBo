import React from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { useAppStore } from '../../store/AppContext';
import { useSession } from '../../lib/session';
import { formatRupiah } from '../../lib/format';

interface CampusDiscountCardProps {
  /** The kos's own first-payment discount, when it offers one. Never a made-up figure. */
  studentDiscountAmount?: number;
}
/**
 * Student discount status on checkout. Verification itself (campus email code or link, campus account, KTM) lives in
 * StudentVerificationCard on /profile; this card only shows the state and links there.
 */
export const CampusDiscountCard: React.FC<CampusDiscountCardProps> = ({ studentDiscountAmount }) => {
  const { me } = useSession();
  const { openAuthModal } = useAppStore();
  const verified = !!me?.campusVerified;

  return (
    <div
      style={{
        backgroundColor: verified ? 'var(--primary-light)' : 'var(--bg-page)',
        border: `1.5px solid ${verified ? 'var(--primary)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '1.1rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: verified ? 'var(--primary)' : 'var(--bg-muted)', color: verified ? 'white' : 'var(--text-muted)' }}>
          <GraduationCap size={22} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h4 style={{ fontSize: 'var(--step-0)', fontWeight: 700, color: 'var(--text-main)' }}>Potongan mahasiswa dari pemilik</h4>
          <p style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            {verified
              ? (studentDiscountAmount ? `Potongan ${formatRupiah(studentDiscountAmount)} berlaku otomatis pada pembayaran pertama.` : 'Berlaku untuk pembayaran pertama pada kos yang menyediakannya.')
              : (studentDiscountAmount ? `Verifikasi status mahasiswa untuk potongan ${formatRupiah(studentDiscountAmount)} di pembayaran pertama.` : 'Verifikasi status mahasiswa untuk klaim potongan dari pemilik.')}
          </p>
        </div>
      </div>
      {verified ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--primary)', fontSize: 'var(--step--1)', fontWeight: 700, flexShrink: 0 }}>
          <CheckCircle2 size={16} />
          <span>Aktif</span>
        </div>
      ) : me ? (
        !me.user.isDemo && (
          <Link to="/profile">
            <Button size="sm" variant="primary">Verifikasi</Button>
          </Link>
        )
      ) : (
        <Button size="sm" variant="primary" onClick={openAuthModal}>Masuk</Button>
      )}
    </div>
  );
};
