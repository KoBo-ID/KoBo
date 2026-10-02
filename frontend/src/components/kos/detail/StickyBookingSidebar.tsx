import React from 'react';
import { CreditCard, Calendar, GraduationCap, ShieldCheck } from 'lucide-react';
import { Room, Kos } from '../../../types';
import { Button } from '../../ui/Button';

interface StickyBookingSidebarProps {
  kos: Kos;
  selectedRoom: Room;
  leaseMonths: number;
  onSelectLeaseMonths: (months: number) => void;
  onGoToCheckout: () => void;
  onOpenSurveyModal: () => void;
}

export const StickyBookingSidebar: React.FC<StickyBookingSidebarProps> = ({
  kos,
  selectedRoom,
  leaseMonths,
  onSelectLeaseMonths,
  onGoToCheckout,
  onOpenSurveyModal,
}) => {
  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const appFee = 25000;
  const isVacant = selectedRoom.status === 'vacant';
  const hasDiscount = kos.studentDiscountAmount > 0;
  const total =
    (hasDiscount ? selectedRoom.priceMonthly - kos.studentDiscountAmount : selectedRoom.priceMonthly) * leaseMonths +
    appFee;

  /* Height budget @1280x720 (worst case: discounted kos, 4 fee lines).
     price 44 + lease 52 + fees 126 (4 lines + sep + campus caption) + CTAs 100
     + trust 28 = 350 content, + 4 gaps x 14 = 56, + padding 48  =>  ~454px.
     Sticky window = 720 - 72 header - 24 top offset ~= 504px, so the card
     clears it with ~50px to spare and paddingBottom keeps a visible gap.
     maxHeight/overflowY remain only as a safety valve for shorter windows. */
  return (
    <aside
      style={{
        position: 'sticky',
        top: 'var(--sticky-top)',
        zIndex: 'var(--z-sticky)',
        width: '100%',
        maxWidth: '360px',
        paddingBottom: '1.5rem',
        maxHeight: 'calc(100vh - var(--header-height) - 3rem)',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 'var(--radius-card)',
          border: '1.5px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-md)',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.875rem',
        }}
      >
        {/* Top Price Header */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.35rem',
              marginBottom: '0',
              flexWrap: 'nowrap',
            }}
          >
            <span style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
              {formatRupiah(selectedRoom.priceMonthly)}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>/ bulan</span>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
            Kamar {selectedRoom.roomNumber} ({selectedRoom.roomType})
          </span>
        </div>

        {/* Lease Duration Tabs */}
        <div>
          <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem', color: 'var(--text-muted)' }}>
            Pilihan Durasi Sewa:
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
            {[1, 3, 12].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onSelectLeaseMonths(m)}
                className="interactive-tap"
                style={{
                  padding: '0.4rem 0.25rem',
                  borderRadius: 'var(--radius-btn)',
                  fontSize: '0.8rem',
                  fontWeight: leaseMonths === m ? 700 : 500,
                  backgroundColor: leaseMonths === m ? 'var(--primary-light)' : 'var(--bg-page)',
                  color: leaseMonths === m ? 'var(--primary)' : 'var(--text-main)',
                  border: `1.5px solid ${leaseMonths === m ? 'var(--primary)' : 'var(--border-subtle)'}`,
                }}
              >
                {m === 12 ? '1 Tahun' : `${m} Bulan`}
              </button>
            ))}
          </div>
        </div>

        {/* Fees Breakdown Preview */}
        <div
          style={{
            backgroundColor: 'var(--bg-page)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.7rem 0.85rem',
            fontSize: '0.8125rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.3rem',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span>Sewa ({leaseMonths} Bulan)</span>
            <span>{formatRupiah(selectedRoom.priceMonthly * leaseMonths)}</span>
          </div>
          {hasDiscount && (
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <GraduationCap size={13} />
                Diskon Mahasiswa
              </span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
                -{formatRupiah(kos.studentDiscountAmount * leaseMonths)}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
            <span>Biaya Layanan & Kuitansi Digital</span>
            <span>{formatRupiah(appFee)}</span>
          </div>
          <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '0.25rem 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--text-main)', fontSize: '0.875rem' }}>
            <span>Total Estimasi</span>
            <span>{formatRupiah(total)}</span>
          </div>
          {hasDiscount && (
            <p style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', margin: '0.15rem 0 0' }}>
              Diskon aktif otomatis setelah verifikasi email kampus.
            </p>
          )}
        </div>


        {/* Strict CTA Visual Hierarchy: Exactly ONE Dominant Primary CTA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={!isVacant}
            onClick={onGoToCheckout}
            icon={<CreditCard size={18} />}
          >
            {isVacant ? 'Ajukan Sewa & Bayar' : 'Kamar Saat Ini Terisi'}
          </Button>

          {/* Subordinate Secondary Action: Ghost/Outline at Medium Size */}
          <Button
            variant="outline"
            size="md"
            fullWidth
            onClick={onOpenSurveyModal}
            icon={<Calendar size={16} />}
          >
            Jadwalkan Survey Gratis
          </Button>
        </div>

        <div
          style={{
            paddingTop: '0.65rem',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.35rem',
          }}
        >
          <ShieldCheck size={14} color="var(--primary)" />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
            Survey fisik gratis · Tanpa biaya tersembunyi
          </span>
        </div>
      </div>
    </aside>
  );
};
