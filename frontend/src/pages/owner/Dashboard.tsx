import '../../styles/owner-dashboard.css';
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, CheckCircle2, ChevronRight } from 'lucide-react';
import { todayWIB } from '@kobo/shared/domain';
import type { BoardRoom, TenancyEndPreview } from '../../../../backend/src/trpc/router';
import { EndTenancyDialog, type ArrearsChoice } from '../../components/owner/EndTenancyDialog';
import { useAppStore } from '../../store/AppContext';
import { messageForError } from '../../lib/errors';
import { daysLate } from '../../lib/billingState';
import { formatLongDateWIB } from '../../lib/dates';
import { supportMailto } from '../../lib/support';
import { OwnerOverview } from '../../components/owner/OwnerOverview';
import { RoomOccupancyBoard } from '../../components/owner/RoomOccupancyBoard';
import { ApplicationsPanel } from '../../components/owner/ApplicationsPanel';
import { VisitsPanel } from '../../components/owner/VisitsPanel';
import { RemindersLog } from '../../components/owner/RemindersLog';
import { TenantProfileModal } from '../../components/owner/TenantProfileModal';
import { ManualPaymentModal } from '../../components/owner/ManualPaymentModal';
import { Notice } from '../../components/ui/Notice';
import { WhatsAppModal } from '../../components/owner/WhatsAppModal';
import { OwnerPageHeader } from '../../components/owner/OwnerPageHeader';
import { RoomStatus } from '../../types';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/QueryState';
import { formatDueDate, formatRupiah, useOwnerWorkspace } from '../../lib/ownerWorkspace';
import { useRoomActions } from '../../lib/ownerActions';
import { useOwnerVisits } from '../../lib/visits';
import { useTRPC } from '../../lib/trpc';
import { useOwnerGate } from '../../lib/owner';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/** 'YYYY-MM-DD' (a WIB calendar day) as "5 Oktober 2026". */
const formatLongDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }) : '-';

const CHANGED_NOTICE = 'Tagihan penyewa berubah. Periksa lagi sebelum mengakhiri sewa.';
const isConflict = (e: unknown) => (e as { data?: { code?: string } } | null)?.data?.code === 'CONFLICT';

const START_STEPS =['Daftarkan kos', 'Tambah kamar dan harga', 'Terima pengajuan sewa'];


const DashboardSkeleton: React.FC = () => (
  <div className="app-container owner-page" role="status" aria-live="polite" aria-label="Memuat papan okupansi">
    <OwnerPageHeader title="Papan okupansi" />
    <div className="od-hero" aria-hidden="true">
      <div className="od-money">
        <Skeleton width="40%" height="0.8rem" />
        <Skeleton width="65%" height="2.2rem" />
        <Skeleton width="100%" height="0.5rem" />
        <Skeleton width="55%" height="0.8rem" />
      </div>
      <div className="od-building">
        <Skeleton width="45%" height="0.8rem" />
        <Skeleton width="70%" height="1.4rem" />
        <Skeleton width="100%" height="1.25rem" />
        <Skeleton width="80%" height="1.5rem" />
      </div>
    </div>
    <div className="od-skel-list" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="od-skel-row">
          <Skeleton width="70%" height="1rem" />
          <Skeleton width="50%" height="1rem" />
          <Skeleton width="60%" height="1rem" />
        </div>
      ))}
    </div>
  </div>
);

export const OwnerDashboard: React.FC = () => {
  useDocumentTitle('Papan okupansi');
  const { selectedKos } = useOwnerWorkspace();
  const gate = useOwnerGate();
  const trpc = useTRPC();
  const board = useQuery({ ...trpc.owner.board.queryOptions({ kosId: selectedKos?.id ?? '' }), enabled: !!selectedKos,
    // Online payments settle by webhook: refresh while the tab is visible (React Query pauses hidden tabs by default).
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
  });
  const visits = useOwnerVisits(selectedKos?.id);
  const applications = useQuery({ ...trpc.application.ownerList.queryOptions({ kosId: selectedKos?.id ?? '' }), enabled: !!selectedKos });
  const { busyRoomId, markPaid, endTenancy, previewEnd } = useRoomActions(selectedKos?.id);
  const { addToast } = useAppStore();
  // Two views of one set of queries: the overview (money, building, room board) and the inbox of things to act on.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: 'ringkasan' | 'tindakan' = searchParams.get('tab') === 'tindakan' ? 'tindakan' : 'ringkasan';
  const setTab = (next: 'ringkasan' | 'tindakan') =>
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 'tindakan') p.set('tab', 'tindakan');
      else p.delete('tab');
      return p;
    }, { replace: true });

  const [whatsAppTargetRoom, setWhatsAppTargetRoom] = useState<BoardRoom | null>(null);
  const [statusFilter, setStatusFilter] = useState<RoomStatus | 'all'>('all');
  const [confirmingRoom, setConfirmingRoom] = useState<BoardRoom | null>(null);
  const [payingRoom, setPayingRoom] = useState<BoardRoom | null>(null);
  const [profileTenancy, setProfileTenancy] = useState<string | null>(null);
  const [confirmFuture, setConfirmFuture] = useState(false);
  const [endDialog, setEndDialog] = useState<{ room: BoardRoom; preview: TenancyEndPreview } | null>(null);
  const [endNotice, setEndNotice] = useState<string | null>(null);
  const [payingFormer, setPayingFormer] = useState<{ tenancyId: string; roomNumber: string; tenantName: string; invoice: { invoiceId: string; dueDate: string; amount: number } } | null>(null);
  const [scrollToFormer, setScrollToFormer] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (confirmingRoom) confirmRef.current?.focus();
  }, [confirmingRoom]);

  // "Lihat tunggakan" on the Ringkasan tile: once the Perlu tindakan tab has rendered, bring the section into view.
  useEffect(() => {
    if (!scrollToFormer || tab !== 'tindakan') return;
    const el = document.getElementById('former-arrears-title');
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    setScrollToFormer(false);
  }, [scrollToFormer, tab, board.data]);

  const cancelConfirm = () => {
    setConfirmingRoom(null);
    lastTrigger.current?.focus();
  };

  if (!selectedKos) {
    return (
      <div className="app-container owner-page">
        <OwnerPageHeader title="Papan okupansi" />
        <div className="od-start">
          <h2>Belum ada kos</h2>
          <ol className="od-steps">
            {START_STEPS.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ol>
          {gate.approved ? (
            <ButtonLink to="/owner/kos" variant="primary" size="md">Daftarkan kos</ButtonLink>
          ) : (
            <div className="os-gate" style={{ alignItems: 'flex-start' }}>
              <Button variant="primary" size="md" aria-disabled="true" aria-describedby="od-gate-reason" onClick={gate.openDocs} style={{ opacity: 0.6 }}>Daftarkan kos</Button>
              <p id="od-gate-reason" className="os-gate__reason" style={{ textAlign: 'left' }}>
                {gate.reason} <button type="button" className="os-gate__link" onClick={gate.openDocs}>Buka dokumen</button>
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (board.isError) {
    return <ErrorState message="Gagal memuat papan kamar." onRetry={() => void board.refetch()} />;
  }
  // Wait for the visits too so the page lands in its final layout. A failed visits query does not block it.
  if (!board.data || visits.isPending || applications.isPending) return <DashboardSkeleton />;

  const { rooms, summary } = board.data;
  const attentionRooms = rooms
    .filter((r) => r.status === 'overdue' || r.status === 'due')
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  // An ACTIVE tenancy past its lease end: nothing ends it by itself, so the owner is asked to extend or end it.
  const leaseEndedRooms = rooms.filter((r) => r.leaseEnded && r.tenancyId);

  const needsReview = rooms.filter((r) => r.payment?.state === 'NEEDS_REVIEW');

  const OK_PLAIN = 'Sewa diakhiri. Kamar kembali kosong.';

  /** Fetches what ending would leave unpaid, then opens the bar (nothing owed) or the dialog (arrears). A booking cancel is always the bar. */
  const askEnd = async (room: BoardRoom) => {
    if (!room.tenancyId) return;
    lastTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (room.status === 'booking') {
      setConfirmFuture(false);
      setConfirmingRoom(room);
      return;
    }
    const preview = await previewEnd(room.id, room.tenancyId);
    if (!preview) return;
    if (preview.arrearsTotal > 0) {
      setEndNotice(null);
      setEndDialog({ room, preview });
    } else {
      setConfirmFuture(preview.futureUnpaidCount > 0);
      setConfirmingRoom(room);
    }
  };
  const doEnd = async () => {
    const room = confirmingRoom;
    if (!room?.tenancyId) return;
    setConfirmingRoom(null);
    const result = await endTenancy(room.id, room.tenancyId, { okMessage: OK_PLAIN });
    if (result.ok) return;
    if (isConflict(result.error)) {
      // Arrears appeared after the preview: show them instead of ending silently.
      const fresh = await previewEnd(room.id, room.tenancyId, { quiet: true });
      if (fresh && fresh.arrearsTotal > 0) {
        setEndNotice(CHANGED_NOTICE);
        setEndDialog({ room, preview: fresh });
        return;
      }
    }
    addToast(messageForError(result.error), 'error');
  };
  const doEndWithArrears = async (choice: ArrearsChoice) => {
    if (!endDialog?.room.tenancyId) return;
    const { room, preview } = endDialog;
    const total = formatRupiah(preview.arrearsTotal);
    const okMessage = choice.arrears === 'WAIVE'
      ? `Sewa diakhiri. Tunggakan ${total} dihapus.`
      : `Sewa diakhiri. Tunggakan ${total} tetap tercatat sebagai tunggakan penyewa lama.`;
    setEndNotice(null);
    const result = await endTenancy(room.id, room.tenancyId!, { okMessage, arrears: choice.arrears, waiverReason: choice.waiverReason });
    if (result.ok) {
      setEndDialog(null);
      return;
    }
    if (isConflict(result.error)) {
      const fresh = await previewEnd(room.id, room.tenancyId!, { quiet: true });
      if (fresh && fresh.arrearsTotal > 0) {
        setEndDialog({ room, preview: fresh });
        setEndNotice(CHANGED_NOTICE);
        return;
      }
      if (fresh) {
        // Nothing is owed any more: fall back to the plain bar.
        setEndDialog(null);
        setConfirmFuture(fresh.futureUnpaidCount > 0);
        setConfirmingRoom(room);
        return;
      }
    }
    setEndNotice(messageForError(result.error));
  };
  const pay = (room: BoardRoom) => {
    if (room.invoice) setPayingRoom(room);
  };
  const showFormerArrears = () => {
    setScrollToFormer(true);
    setTab('tindakan');
  };

  const hasAttention = attentionRooms.length > 0;
  const scheduledVisits = (visits.data ?? []).filter((v) => v.status === 'SCHEDULED').length;
  const hasVisitAttention = scheduledVisits > 0;
  const applicationCount = applications.data?.length ?? 0;
  const hasApplications = applicationCount > 0;
  const hasLeaseEnded = leaseEndedRooms.length > 0;
  const formerInvoices = summary.formerTenantArrears.flatMap((t) => t.invoices.map((inv) => ({ ...inv, tenancyId: t.tenancyId, roomNumber: t.roomNumber, tenantName: t.tenantName })));
  const hasFormer = formerInvoices.length > 0;
  const today = todayWIB(new Date());
  const allClear = !hasAttention && !hasVisitAttention && !hasApplications && !hasLeaseEnded && needsReview.length === 0 && !hasFormer;
  const actionCount = attentionRooms.length + scheduledVisits + applicationCount + needsReview.length + leaseEndedRooms.length + formerInvoices.length;
  const showStatus = (status: RoomStatus) => {
    setStatusFilter(status);
    document.getElementById('room-board-title')?.scrollIntoView({ block: 'start' });
    // Land keyboard focus on the filter that is now applied.
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="Filter status kamar"] [aria-pressed="true"]')?.focus({ preventScroll: true }));
  };
  const confirmVerb = confirmingRoom?.status === 'booking' ? 'Batalkan booking' : 'Akhiri sewa';

  return (
    <div className="app-container owner-page">
      <OwnerPageHeader title="Papan okupansi" />

      <div className="od-tabs kobo-segmented" role="tablist" aria-label="Tampilan papan">
        <button type="button" role="tab" id="od-tab-ringkasan" aria-selected={tab === 'ringkasan'} aria-controls="od-panel" onClick={() => setTab('ringkasan')}>
          Ringkasan
        </button>
        <button type="button" role="tab" id="od-tab-tindakan" aria-selected={tab === 'tindakan'} aria-controls="od-panel" onClick={() => setTab('tindakan')}>
          Perlu tindakan{actionCount > 0 && <span className="od-count-bubble">{actionCount}</span>}
        </button>
      </div>

      {confirmingRoom && (
        <div
          ref={confirmRef}
          className="od-confirm"
          role="alertdialog"
          aria-modal="false"
          aria-label={`${confirmVerb} Kamar ${confirmingRoom.roomNumber}`}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              cancelConfirm();
            }
          }}
        >
          <span>
            {confirmVerb} Kamar {confirmingRoom.roomNumber}
            {confirmingRoom.tenant?.name ? ` (${confirmingRoom.tenant.name})` : ''}?
            {confirmFuture && confirmingRoom.status !== 'booking' && ' Bulan yang belum jatuh tempo tidak akan ditagih.'}
          </span>
          <span className="od-confirm__actions">
            <Button variant="outline" size="sm" onClick={cancelConfirm}>Batal</Button>
            <Button variant="danger" size="sm" onClick={() => void doEnd()}>{confirmVerb}</Button>
          </span>
        </div>
      )}

      <div id="od-panel" role="tabpanel" aria-labelledby={`od-tab-${tab}`}>
        {tab === 'ringkasan' ? (
          <>
            <OwnerOverview summary={summary} kosId={selectedKos.id} onShowStatus={showStatus} onShowFormerArrears={showFormerArrears} />
      <RoomOccupancyBoard
        kosName={selectedKos.name}
        rooms={rooms}
        busyRoomId={busyRoomId}
        filterStatus={statusFilter}
        onFilterStatusChange={setStatusFilter}
        onOpenWhatsApp={setWhatsAppTargetRoom}
        onMarkPaid={pay}
        onEndTenancy={(room) => void askEnd(room)}
        onOpenProfile={setProfileTenancy}
      />

          </>
        ) : (
          <>
      {allClear && (
        <p className="od-clear">
          <CheckCircle2 size={18} aria-hidden="true" />
          Tidak ada tagihan, pengajuan, atau survey yang menunggu.
        </p>
      )}

      <ApplicationsPanel kosId={selectedKos.id} />

      {hasAttention && (
        <section aria-labelledby="attention-title" className="od-section">
          <h2 id="attention-title" className="od-section__title">
            Tagihan belum lunas
            <span className="od-count">{attentionRooms.length}</span>
          </h2>
          <ul className="od-list">
            {attentionRooms.map((room) => (
              <li key={room.id} className="od-row od-row--attention">
                <div className="od-row__main">
                  <span className="od-row__title">Kamar {room.roomNumber}</span>
                  {room.tenancyId ? (
                    <button type="button" className="od-person od-person--sub" aria-label={`Lihat profil penyewa Kamar ${room.roomNumber}`} onClick={() => setProfileTenancy(room.tenancyId!)}>
                      {room.tenant?.name || 'Penghuni aktif'}
                      <ChevronRight size={13} aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="od-row__sub">{room.tenant?.name || 'Penghuni aktif'}</span>
                  )}
                </div>
                <span className="od-row__amount">{formatRupiah(room.invoice?.amount ?? room.priceMonthly)}</span>
                <div className="od-row__due">
                  <span>Jatuh tempo {room.invoice?.dueDate ? formatLongDateWIB(room.invoice.dueDate) : formatDueDate(room.invoice?.dueDate)}</span>
                  {room.daysOverdue > 0 ? <span className="od-row__late">Terlambat {room.daysOverdue} hari</span> : null}
                </div>
                <div className="od-row__actions">
                  <Button variant="outline" size="sm" icon={<MessageSquare size={14} />} onClick={() => setWhatsAppTargetRoom(room)}>
                    Kirim tagihan
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<CheckCircle2 size={14} />}
                    disabled={busyRoomId === room.id || room.payment?.state === 'AWAITING_ONLINE'}
                    title={room.payment?.state === 'AWAITING_ONLINE' ? 'Penyewa sedang membayar online. Tunggu sesi pembayaran berakhir.' : undefined}
                    aria-label={`Tandai Lunas Kamar ${room.roomNumber}`}
                    onClick={() => pay(room)}
                  >
                    Tandai lunas
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasLeaseEnded && (
        <section aria-labelledby="lease-end-title" className="od-section" data-testid="lease-ended-section">
          <h2 id="lease-end-title" className="od-section__title">
            Masa sewa berakhir
            <span className="od-count">{leaseEndedRooms.length}</span>
          </h2>
          <ul className="od-list">
            {leaseEndedRooms.map((room) => (
              <li key={room.id} className="od-row od-row--attention">
                <div className="od-row__main">
                  <span className="od-row__title">Kamar {room.roomNumber}</span>
                  <button type="button" className="od-person od-person--sub" aria-label={`Lihat profil penyewa Kamar ${room.roomNumber}`} onClick={() => setProfileTenancy(room.tenancyId!)}>
                    {room.tenant?.name || 'Penghuni aktif'}
                    <ChevronRight size={13} aria-hidden="true" />
                  </button>
                </div>
                <div className="od-row__due">
                  <span>Masa sewa berakhir {formatLongDate(room.leaseEndDate)}</span>
                </div>
                <div className="od-row__actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyRoomId === room.id}
                    aria-label={`Akhiri sewa Kamar ${room.roomNumber}`}
                    onClick={() => void askEnd(room)}
                  >
                    Akhiri sewa
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasFormer && (
        <section aria-labelledby="former-arrears-title" className="od-section" data-testid="former-arrears-section">
          <h2 id="former-arrears-title" className="od-section__title">
            Tunggakan penyewa lama
            <span className="od-count">{formerInvoices.length}</span>
          </h2>
          <p className="od-section__intro">Sewa sudah berakhir. Tunggakan ini tetap tercatat sampai dibayar.</p>
          <ul className="od-list">
            {formerInvoices.map((inv) => {
              const late = daysLate(inv.dueDate, today);
              return (
                <li key={inv.invoiceId} className="od-row od-row--attention">
                  <div className="od-row__main">
                    <span className="od-row__title">Kamar {inv.roomNumber}</span>
                    <button type="button" className="od-person od-person--sub" aria-label={`Lihat profil penyewa Kamar ${inv.roomNumber}`} onClick={() => setProfileTenancy(inv.tenancyId)}>
                      {inv.tenantName || 'Penyewa lama'}
                      <ChevronRight size={13} aria-hidden="true" />
                    </button>
                  </div>
                  <span className="od-row__amount">{formatRupiah(inv.amount)}</span>
                  <div className="od-row__due">
                    <span>Jatuh tempo {formatLongDateWIB(inv.dueDate)}</span>
                    {late > 0 ? <span className="od-row__late">Terlambat {late} hari</span> : null}
                  </div>
                  <div className="od-row__actions">
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<CheckCircle2 size={14} />}
                      disabled={busyRoomId === inv.tenancyId}
                      aria-label={`Tandai lunas tunggakan Kamar ${inv.roomNumber}, jatuh tempo ${formatLongDateWIB(inv.dueDate)}`}
                      onClick={() => setPayingFormer({ tenancyId: inv.tenancyId, roomNumber: inv.roomNumber, tenantName: inv.tenantName, invoice: { invoiceId: inv.invoiceId, dueDate: inv.dueDate, amount: inv.amount } })}
                    >
                      Tandai lunas
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <VisitsPanel kosId={selectedKos.id} />

      {needsReview.length > 0 && (() => {
        const rooms = needsReview.map((r) => r.roomNumber).join(', ');
        return (
          <Notice tone="error">
            Pengembalian dana gagal untuk Kamar {rooms}. Dana penyewa belum kembali.{' '}
            <a href={supportMailto(`Pengembalian dana gagal Kamar ${rooms}`)} style={{ color: 'var(--primary)', fontWeight: 700 }}>
              Hubungi KoBo agar segera ditinjau
            </a>
          </Notice>
        );
      })()}

            <RemindersLog kosId={selectedKos.id} />
          </>
        )}
      </div>

      {profileTenancy && <TenantProfileModal target={{ kosId: selectedKos.id, tenancyId: profileTenancy }} onClose={() => setProfileTenancy(null)} />}

      {endDialog && (
        <EndTenancyDialog
          roomNumber={endDialog.room.roomNumber}
          tenantName={endDialog.room.tenant?.name}
          preview={endDialog.preview}
          busy={busyRoomId === endDialog.room.id}
          notice={endNotice}
          onCancel={() => { setEndDialog(null); setEndNotice(null); }}
          onConfirm={(choice) => void doEndWithArrears(choice)}
        />
      )}

      {payingFormer && (
        <ManualPaymentModal
          title={`Tandai Lunas Kamar ${payingFormer.roomNumber}`}
          subtitle={`${payingFormer.tenantName} · tagihan jatuh tempo ${formatLongDateWIB(payingFormer.invoice.dueDate)}`}
          invoice={{ id: payingFormer.invoice.invoiceId, amount: payingFormer.invoice.amount }}
          busy={busyRoomId === payingFormer.tenancyId}
          onClose={() => setPayingFormer(null)}
          onSubmit={async (input) => {
            if (await markPaid(payingFormer.tenancyId, { invoiceId: payingFormer.invoice.invoiceId, ...input })) setPayingFormer(null);
          }}
        />
      )}

      {payingRoom?.invoice && (
        <ManualPaymentModal
          title={`Tandai Lunas Kamar ${payingRoom.roomNumber}`}
          subtitle={`${payingRoom.tenant?.name || 'Penghuni aktif'} · tagihan jatuh tempo ${formatLongDateWIB(payingRoom.invoice.dueDate)}`}
          online={payingRoom.payment?.state === 'AWAITING_ONLINE'}
          invoice={payingRoom.invoice}
          busy={busyRoomId === payingRoom.id}
          onClose={() => setPayingRoom(null)}
          onSubmit={async (input) => {
            if (await markPaid(payingRoom.id, { invoiceId: payingRoom.invoice!.id, ...input })) setPayingRoom(null);
          }}
        />
      )}

      {whatsAppTargetRoom && (
        <WhatsAppModal isOpen onClose={() => setWhatsAppTargetRoom(null)} room={whatsAppTargetRoom} kosName={selectedKos.name} />
      )}
    </div>
  );
};
