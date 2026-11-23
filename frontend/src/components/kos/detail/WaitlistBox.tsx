import React, { useState } from 'react';
import { BellRing, Hourglass, Users } from 'lucide-react';
import type { MyWaitlistEntry, WaitlistStatusResult } from '../../../../../backend/src/trpc/router';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { useAppStore } from '../../../store/AppContext';
import { useSession } from '../../../lib/session';
import { formatTimeLeft, roomTypeLabel, useNow, useWaitlistActions } from '../../../lib/waitlist';
import { formatRupiah } from '../../../lib/format';
const ANY = '__any__';

/** "Anda di antrean #3" card with the way out. */
export const QueuedCard: React.FC<{ entry: MyWaitlistEntry }> = ({ entry }) => {
  const { leave, busy } = useWaitlistActions();
  return (
    <div data-testid="waitlist-queued" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 'var(--radius-btn)', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Hourglass size={18} />
        </span>
        <div>
          <div style={{ fontSize: 'var(--step-1)', fontWeight: 800, color: 'var(--text-main)' }}>Anda di antrean #{entry.position}</div>
          <div style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>{roomTypeLabel(entry.roomType)}</div>
        </div>
      </div>
      <p style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
        Kami kirim email saat kamar tersedia. Anda punya 24 jam untuk mengajukan sewa.
      </p>
      <Button variant="outline" size="md" fullWidth disabled={busy} onClick={() => void leave(entry.id)}>
        Keluar antrean
      </Button>
    </div>
  );
};

/** "Kamar 105 ditawarkan untuk Anda" banner with a live countdown. */
export const OfferBanner: React.FC<{ entry: MyWaitlistEntry; onBook: (roomId: string) => void }> = ({ entry, onBook }) => {
  const { decline, busy } = useWaitlistActions();
  const now = useNow();
  const offer = entry.offer;
  if (!offer) return null;
  const hasPendingApp = entry.applicationStatus === 'PENDING';
  return (
    <div
      data-testid="waitlist-offer"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', padding: '0.9rem', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--primary-light)', border: '1.5px solid var(--primary)' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
        <BellRing size={20} color="var(--primary)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 'var(--step-0)', fontWeight: 800, color: 'var(--text-main)' }}>Kamar {offer.roomNumber} ditawarkan untuk Anda</div>
          <div style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            {formatRupiah(offer.priceMonthly)} / bulan · <strong style={{ color: 'var(--primary)' }}>{formatTimeLeft(offer.expiresAt, now)}</strong>
          </div>
        </div>
      </div>
      {hasPendingApp ? (
        <>
          <p role="status" style={{ fontSize: 'var(--step--1)', fontWeight: 600, color: 'var(--primary)', lineHeight: 1.5, margin: 0 }}>
            Pengajuan Anda sedang ditinjau pemilik
          </p>
          <p style={{ fontSize: 'var(--step--2)', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>Tawaran ditahan selama pemilik meninjau pengajuan Anda.</p>
          <Button variant="outline" size="md" fullWidth disabled={busy} onClick={() => void decline(entry.id)}>
            Batalkan Pengajuan
          </Button>
        </>
      ) : (
        <>
          <Button variant="primary" size="lg" fullWidth disabled={busy} onClick={() => onBook(offer.roomId)}>
            Ajukan Sewa
          </Button>
          <p style={{ fontSize: 'var(--step--2)', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>Tawaran ditahan selama pemilik meninjau pengajuan Anda.</p>
          <Button variant="outline" size="md" fullWidth disabled={busy} onClick={() => void decline(entry.id)}>
            Lewati
          </Button>
        </>
      )}
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
  const fullTypeSet = new Set(status.fullTypes);
  const typeOptions = (status.full ? status.types : status.types.filter((t) => t.roomType !== null && fullTypeSet.has(t.roomType)))
    .map((t) => ({ value: t.roomType ?? ANY, label: t.waiting > 0 ? `${t.roomType} · ${t.waiting} mengantre` : `${t.roomType}` }));
  const options = status.full ? [{ value: ANY, label: 'Tipe apa saja' }, ...typeOptions] : typeOptions;
  const [type, setType] = useState<string>(() =>
    status.full ? (initialType ?? ANY) : (initialType && fullTypeSet.has(initialType) ? initialType : (status.fullTypes[0] ?? ANY)),
  );
  const selectedType = options.some((o) => o.value === type) ? type : (options[0]?.value ?? ANY);

  if (status.rentingHere) {
    return (
      <div data-testid="waitlist-join" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>Anda sudah menyewa kamar di kos ini, jadi tidak perlu ikut daftar tunggu.</div>
        {onBack && (
          <Button variant="ghost" size="sm" fullWidth onClick={onBack}>
            Lihat kamar yang tersedia
          </Button>
        )}
      </div>
    );
  }

  return (
    <div data-testid="waitlist-join" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 'var(--radius-btn)', backgroundColor: 'var(--status-overdue-bg)', color: 'var(--status-overdue-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Users size={18} />
        </span>
        <div>
          <div style={{ fontSize: 'var(--step-1)', fontWeight: 800, color: 'var(--text-main)' }}>{status.full ? 'Kamar Penuh' : 'Tipe Ini Penuh'}</div>
          <div style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)' }}>Antre dulu, Anda dapat giliran sesuai nomor antrean.</div>
        </div>
      </div>
      <Select label="Tipe kamar yang dicari" value={selectedType} onChange={(e) => setType(e.target.value)} options={options} />
      <Button
        variant="primary"
        size="lg"
        fullWidth
        disabled={busy || (!status.full && options.length === 0)}
        onClick={() => {
          if (!me) return openAuthModal();
          void join(kosId, selectedType === ANY ? null : selectedType);
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
