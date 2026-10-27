import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { leaseQuote } from '@kobo/shared/domain';
import { useSession } from '../../../lib/session';
import { ClipboardList, Calendar, GraduationCap, ShieldCheck } from 'lucide-react';
import type { WaitlistStatusResult } from '../../../../../backend/src/trpc/router';
import { Room, Kos } from '../../../types';
import { Button } from '../../ui/Button';
import { JoinCard, OfferBanner, QueuedCard } from './WaitlistBox';
import { formatRupiah } from '../../../lib/format';

interface StickyBookingSidebarProps {
  kos: Kos;
  selectedRoom: Room;
  leaseMonths: number;
  onSelectLeaseMonths: (months: number) => void;
  onGoToCheckout: () => void;
  onOpenSurveyModal: () => void;
  /** Daftar tunggu state of this kos. */
  waitlist: {
    status: WaitlistStatusResult | undefined;
    /** Set when the student picked a full type in the room list (null = any type). */
    joinType: string | null | undefined;
    onBookOffer: (roomId: string) => void;
    onBackToBooking: () => void;
  };
}

const FeeRow: React.FC<{ label: React.ReactNode; note?: React.ReactNode; value: string; accent?: boolean; strong?: boolean; testId?: string }> = ({ label, note, value, accent, strong, testId }) => (
  <div className={`booking-fee-row${strong ? ' booking-fee-row--strong' : ''}`}>
    <span style={{ minWidth: 0 }}>{label}</span>
    <span className="booking-fee-row__value" data-testid={testId} style={accent ? { color: 'var(--accent-strong)', fontWeight: 600 } : undefined}>{value}</span>
    {note && <span className="booking-fee-row__note">{note}</span>}
  </div>
);

export const StickyBookingSidebar: React.FC<StickyBookingSidebarProps> = ({
  kos,
  selectedRoom,
  leaseMonths,
  onSelectLeaseMonths,
  onGoToCheckout,
  onOpenSurveyModal,
  waitlist,
}) => {
  const { me, isLoading: sessionLoading } = useSession();
  const verified = !!me?.campusVerified;
  const isVacant = selectedRoom.status === 'vacant' && !selectedRoom.reservedForWaitlist;
  const hasDiscount = kos.studentDiscountAmount > 0;
  const quoteInput = {
    monthlyRent: selectedRoom.priceMonthly,
    applicationFee: kos.applicationFee,
    discountAmount: kos.studentDiscountAmount,
    campusEmailVerified: verified,
    months: leaseMonths,
  };
  const quote = leaseQuote(quoteInput);
  // What a verified campus email would take off invoice #1 (shown as a hint to everyone else).
  const hintDiscount = hasDiscount && !verified && !sessionLoading
    ? leaseQuote({ ...quoteInput, campusEmailVerified: true }).discount
    : 0;

  // Daftar tunggu: an offer to me wins, then my queue place, then the join form (full kos, or a full type picked in the list).
  const { status } = waitlist;
  const mine = status?.mine ?? null;
  const offerEntry = mine?.status === 'OFFERED' ? mine : null;
  const queuedEntry = mine?.status === 'WAITING' ? mine : null;
  const full = status?.full ?? false;
  const showJoin = !!status && !offerEntry && !queuedEntry && (full || waitlist.joinType !== undefined);
  const showBooking = !showJoin && !(queuedEntry && full);

  // Phones: once the booking box has scrolled out of view, a thin bar keeps the price and both actions in reach.
  // CSS shows it only below the two-column breakpoint (`.booking-phone-bar`).
  const asideRef = useRef<HTMLElement>(null);
  const [boxOffscreen, setBoxOffscreen] = useState(false);
  // Sticky offset: normally just under the header; when the card is taller than the window the offset goes negative so
  // the card's bottom (both actions) pins to the window bottom while the top scrolls away. No inner scrollbar, no hidden line.
  const [stickyTop, setStickyTop] = useState<string>('var(--sticky-top)');
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const update = () => {
      const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 72;
      const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const normal = header + rootPx * 1.5;
      const fit = window.innerHeight - el.getBoundingClientRect().height - rootPx * 1.5;
      setStickyTop(fit >= normal ? 'var(--sticky-top)' : `${Math.round(fit)}px`);
    };
    update();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  const phoneBarEligible = showBooking && !offerEntry && isVacant;
  useEffect(() => {
    const el = asideRef.current;
    if (!el || !phoneBarEligible || typeof IntersectionObserver === 'undefined') {
      setBoxOffscreen(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setBoxOffscreen(!entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, [phoneBarEligible]);

  /* Height budget @1280x650 (worst case: discounted kos, 3 months, unverified hint). The sticky window is
     650 - 72 header - 24 offset = 554px. The box shows every payment line, so on windows shorter than 800px CSS lets it scroll
     with the page instead of squeezing it (see `.booking-sidebar` in components.css). */
  return (
    <>
    <aside
      ref={asideRef}
      className="booking-sidebar"
      style={{
        position: 'sticky',
        top: stickyTop,
        zIndex: 'var(--z-sticky)',
        width: '100%',
        maxWidth: '384px',
        padding: '0 0 0.5rem',
      }}
    >
      <div
        className="booking-card"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-md)',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          lineHeight: 1.4,
        }}
      >
        {offerEntry && <OfferBanner entry={offerEntry} onBook={waitlist.onBookOffer} />}
        {queuedEntry && <QueuedCard entry={queuedEntry} />}
        {showJoin && status && (
          <JoinCard key={String(waitlist.joinType)} kosId={kos.id} status={status} initialType={waitlist.joinType ?? null} onBack={full ? undefined : waitlist.onBackToBooking} />
        )}

        {showBooking && (<>
        {/* Rent headline: the number people compare across kos. */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flexWrap: 'nowrap' }}>
            <span style={{ fontSize: '1.65rem', fontWeight: 800, lineHeight: 1.1, color: 'var(--text-main)', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
              {formatRupiah(selectedRoom.priceMonthly)}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>/ bulan</span>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Kamar {selectedRoom.roomNumber} ({selectedRoom.roomType})
          </span>
        </div>

        {/* Lease duration */}
        <div role="group" aria-label="Durasi sewa" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
          {[1, 3, 12].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onSelectLeaseMonths(m)}
              className="interactive-tap"
              aria-pressed={leaseMonths === m}
              style={{
                minHeight: '44px',
                padding: '0.5rem 0.25rem',
                borderRadius: 'var(--radius-btn)',
                fontSize: '0.8125rem',
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

        {/* Payment lines: always visible. Left out next to a daftar tunggu offer (the banner is the action and checkout
            shows the total). */}
        {!offerEntry && (
        <div className="booking-lines">
          <div className="booking-lines__rows">
            <FeeRow
              label="Sewa bulan pertama"
              value={formatRupiah(quote.rent)}
              note={hintDiscount > 0 ? (
                <>Mahasiswa: <Link to="/profile" style={{ color: 'var(--primary)', fontWeight: 600 }}>verifikasi email kampus</Link> untuk potongan {formatRupiah(hintDiscount)} di pembayaran pertama.</>
              ) : undefined}
            />
            {quote.discount > 0 && (
              <FeeRow
                accent
                label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><GraduationCap size={14} aria-hidden="true" />Diskon mahasiswa</span>}
                value={`-${formatRupiah(quote.discount)}`}
              />
            )}
            {quote.applicationFee > 0 && (
              <FeeRow label="Biaya layanan KoBo" note="sekali, di pembayaran pertama" value={formatRupiah(quote.applicationFee)} />
            )}
          </div>

          <div className="booking-lines__total" aria-live="polite">
            <div className="booking-lines__total-main">
              <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>Pembayaran pertama</span>
              <strong data-testid="sidebar-first-payment" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {formatRupiah(quote.firstPayment)}
              </strong>
            </div>
            <small>perkiraan, setelah pengajuan disetujui</small>
          </div>

          {leaseMonths > 1 && (
            <div className="booking-lines__sum">
              <FeeRow
                strong
                testId="sidebar-lease-total"
                label={`Total ${leaseMonths} bulan (estimasi)`}
                note={`pembayaran pertama + ${quote.laterMonths} × ${formatRupiah(quote.rent)}`}
                value={formatRupiah(quote.leaseTotal)}
              />
            </div>
          )}
        </div>
        )}
        </>)}

        {/* Strict CTA Visual Hierarchy: Exactly ONE Dominant Primary CTA (with an offer, the banner's "Pesan Sekarang" is it) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {showBooking && !offerEntry && (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!isVacant}
              onClick={onGoToCheckout}
              icon={<ClipboardList size={18} />}
              style={{ minHeight: '44px', padding: '0.65rem 1.25rem' }}
            >
              {isVacant ? 'Ajukan Sewa' : 'Kamar Saat Ini Terisi'}
            </Button>
          )}

          {/* Subordinate Secondary Action: Ghost/Outline at Medium Size */}
          <Button
            variant="outline"
            size="md"
            fullWidth
            onClick={onOpenSurveyModal}
            icon={<Calendar size={16} />}
            style={{ minHeight: '44px' }}
          >
            Jadwalkan Survey Gratis
          </Button>
        </div>

        {showBooking && !offerEntry && isVacant && (
          <p style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', margin: '-0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <ShieldCheck size={15} color="var(--primary)" style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>Mengajukan sewa tidak menahan kamar dan tidak memindahkan uang. Anda membayar setelah pemilik menyetujui.</span>
          </p>
        )}
      </div>
    </aside>

    {phoneBarEligible && boxOffscreen && (
      <div className="booking-phone-bar" role="region" aria-label="Ringkasan pemesanan">
        <div className="booking-phone-bar__price">
          <span className="booking-phone-bar__label">Pembayaran pertama · perkiraan</span>
          <strong>{formatRupiah(quote.firstPayment)}</strong>
        </div>
        <Button variant="outline" size="md" onClick={onOpenSurveyModal} style={{ minHeight: '44px' }}>
          Survey
        </Button>
        <Button variant="primary" size="md" onClick={onGoToCheckout} style={{ minHeight: '44px' }}>
          Ajukan
        </Button>
      </div>
    )}
    </>
  );
};
