import React, { useState } from 'react';
import { BellRing, Hourglass, Users } from 'lucide-react';
import type { MyWaitlistEntry, WaitlistStatusResult } from '../../../../../backend/src/trpc/router';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { useAppStore } from '../../../store/AppContext';
import { useSession } from '../../../lib/session';
import { formatTimeLeft, roomTypeLabel, useNow, useWaitlistActions } from '../../../lib/waitlist';

const formatRupiah = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

const ANY = '__any__';

/** "Kamu antrean #3" card with the way out. */
export const QueuedCard: React.FC<{ entry: MyWaitlistEntry }> = ({ entry }) => {
  const { leave, busy } = useWaitlistActions();
  return (
    <div data-testid="waitlist-queued" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 'var(--radius-btn)', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Hourglass size={18} />
        </span>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>Kamu antrean #{entry.position}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{roomTypeLabel(entry.roomType)}</div>
        </div>
      </div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
        Kami kirim email saat kamar tersedia. Kamu punya 24 jam untuk memesan.
      </p>
      <Button variant="outline" size="md" fullWidth disabled={busy} onClick={() => void leave(entry.id)}>
        Keluar antrean
      </Button>
    </div>
  );
};

/** "Kamar 105 ditawarkan untukmu" banner with a live countdown. */
export const OfferBanner: React.FC<{ entry: MyWaitlistEntry; onBook: (roomId: string) => void }> = ({ entry, onBook }) => {
  const { decline, busy } = useWaitlistActions();
  const now = useNow();
  const offer = entry.offer;
  if (!offer) return null;
  return (
    <div
      data-testid="waitlist-offer"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', padding: '0.9rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--primary-light)', border: '1.5px solid var(--primary)' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
        <BellRing size={20} color="var(--primary)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)' }}>Kamar {offer.roomNumber} ditawarkan untukmu</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            {formatRupiah(offer.priceMonthly)} / bulan · <strong style={{ color: 'var(--primary)' }}>{formatTimeLeft(offer.expiresAt, now)}</strong>
          </div>
        </div>
      </div>
      <Button variant="primary" size="lg" fullWidth disabled={busy} onClick={() => onBook(offer.roomId)}>
        Pesan Sekarang
      </Button>
      <Button variant="outline" size="md" fullWidth disabled={busy} onClick={() => void decline(entry.id)}>
        Lewati
      </Button>
    </div>
  );
};

interface JoinCardProps {
  kosId: string;
  status: WaitlistStatusResult;
  /** The type to preselect (null = any). */
  initialType: string | null;
  /** Shown when the kos is not full: the student came here from a full type. */
  onBack?: () => void;
}

/** "Kamar Penuh": type select and the join button. Signed-out visitors get the auth modal first. */
export const JoinCard: React.FC<JoinCardProps> = ({ kosId, status, initialType, onBack }) => {
  const { me } = useSession();
  const { openAuthModal } = useAppStore();
  const { join, busy } = useWaitlistActions();
  const [type, setType] = useState<string>(initialType ?? ANY);

  const options = [
    { value: ANY, label: 'Tipe apa saja' },
    ...status.types.map((t) => ({ value: t.roomType ?? ANY, label: t.waiting > 0 ? `${t.roomType} · ${t.waiting} mengantre` : `${t.roomType}` })),
  ];

  return (
    <div data-testid="waitlist-join" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 'var(--radius-btn)', backgroundColor: 'var(--status-overdue-bg)', color: 'var(--status-overdue)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Users size={18} />
        </span>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>{status.full ? 'Kamar Penuh' : 'Tipe Ini Penuh'}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Antre dulu, kamu dapat giliran sesuai nomor antrean.</div>
        </div>
      </div>
      <Select label="Tipe kamar yang dicari" value={type} onChange={(e) => setType(e.target.value)} options={options} />
      <Button
        variant="primary"
        size="lg"
        fullWidth
        disabled={busy}
        onClick={() => {
          if (!me) return openAuthModal();
          void join(kosId, type === ANY ? null : type);
        }}
      >
        Ikut Daftar Tunggu
      </Button>
      {onBack && (
        <Button variant="ghost" size="sm" fullWidth onClick={onBack}>
          Lihat kamar yang tersedia
        </Button>
      )}
    </div>
  );
};
