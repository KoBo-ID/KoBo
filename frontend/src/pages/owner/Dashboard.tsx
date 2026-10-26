import '../../styles/owner-dashboard.css';
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, CheckCircle2 } from 'lucide-react';
import type { BoardRoom } from '../../../../backend/src/trpc/router';
import { OwnerOverview } from '../../components/owner/OwnerOverview';
import { RoomOccupancyBoard } from '../../components/owner/RoomOccupancyBoard';
import { ApplicationsPanel } from '../../components/owner/ApplicationsPanel';
import { VisitsPanel } from '../../components/owner/VisitsPanel';
import { ManualPaymentModal } from '../../components/owner/ManualPaymentModal';
import { Notice } from '../../components/ui/Notice';
import { WhatsAppModal } from '../../components/owner/WhatsAppModal';
import { OwnerPageHeader } from '../../components/owner/OwnerPageHeader';
import { RoomStatus } from '../../types';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/QueryState';
import { formatDueDate, formatRupiah, useOwnerWorkspace } from '../../lib/ownerWorkspace';
import { useRoomActions } from '../../lib/ownerActions';
import { useOwnerVisits } from '../../lib/visits';
import { useTRPC } from '../../lib/trpc';

const START_STEPS = ['Daftarkan kos', 'Tambah kamar dan harga', 'Terima pengajuan sewa'];

const todayLabel = () =>
  new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jakarta' });

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
  const { selectedKos } = useOwnerWorkspace();
  const trpc = useTRPC();
  const board = useQuery({ ...trpc.owner.board.queryOptions({ kosId: selectedKos?.id ?? '' }), enabled: !!selectedKos,
    // Online payments settle by webhook: refresh while the tab is visible (React Query pauses hidden tabs by default).
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
  });
  const visits = useOwnerVisits(selectedKos?.id);
  const applications = useQuery({ ...trpc.application.ownerList.queryOptions({ kosId: selectedKos?.id ?? '' }), enabled: !!selectedKos });
  const { busyRoomId, markPaid, endTenancy } = useRoomActions(selectedKos?.id);

  const [whatsAppTargetRoom, setWhatsAppTargetRoom] = useState<BoardRoom | null>(null);
  const [statusFilter, setStatusFilter] = useState<RoomStatus | 'all'>('all');
  const [confirmingRoom, setConfirmingRoom] = useState<BoardRoom | null>(null);
  const [payingRoom, setPayingRoom] = useState<BoardRoom | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (confirmingRoom) confirmRef.current?.focus();
  }, [confirmingRoom]);

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
          <Link to="/owner/kos">
            <Button variant="primary" size="md">Daftarkan kos</Button>
          </Link>
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

  const needsReview = rooms.filter((r) => r.payment?.state === 'NEEDS_REVIEW');

  const askEnd = (room: BoardRoom) => {
    if (!room.tenancyId) return;
    lastTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmingRoom(room);
  };
  const doEnd = () => {
    if (confirmingRoom?.tenancyId) void endTenancy(confirmingRoom.id, confirmingRoom.tenancyId);
    setConfirmingRoom(null);
  };
  const pay = (room: BoardRoom) => {
    if (room.invoice) setPayingRoom(room);
  };

  const hasAttention = attentionRooms.length > 0;
  const hasVisitAttention = (visits.data ?? []).some((v) => v.status === 'SCHEDULED');
  const hasApplications = (applications.data?.length ?? 0) > 0;
  const allClear = !hasAttention && !hasVisitAttention && !hasApplications;
  const showStatus = (status: RoomStatus) => {
    setStatusFilter(status);
    document.getElementById('room-board-title')?.scrollIntoView({ block: 'start' });
    // Land keyboard focus on the filter that is now applied.
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="Filter status kamar"] [aria-pressed="true"]')?.focus({ preventScroll: true }));
  };
  const confirmVerb = confirmingRoom?.status === 'booking' ? 'Batalkan booking' : 'Akhiri sewa';

  return (
    <div className="app-container owner-page">
      <OwnerPageHeader title="Papan okupansi" actions={<span className="od-date">{todayLabel()}</span>} />

      <OwnerOverview summary={summary} onShowStatus={showStatus} />

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
          </span>
          <span className="od-confirm__actions">
            <Button variant="outline" size="sm" onClick={cancelConfirm}>Batal</Button>
            <Button variant="danger" size="sm" onClick={doEnd}>{confirmVerb}</Button>
          </span>
        </div>
      )}

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
                  <span className="od-row__sub">{room.tenant?.name || 'Penghuni aktif'}</span>
                </div>
                <span className="od-row__amount">{formatRupiah(room.invoice?.amount ?? room.priceMonthly)}</span>
                <div className="od-row__due">
                  <span>Jatuh tempo {formatDueDate(room.invoice?.dueDate)}</span>
                  {room.daysOverdue > 0 ? <span className="od-chip od-chip--late">Telat {room.daysOverdue} hari</span> : null}
                </div>
                <div className="od-row__actions">
                  <Button variant="outline" size="sm" icon={<MessageSquare size={14} />} onClick={() => setWhatsAppTargetRoom(room)}>
                    Kirim tagihan
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<CheckCircle2 size={14} />}
                    disabled={busyRoomId === room.id}
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

      <VisitsPanel kosId={selectedKos.id} promoted={hasVisitAttention} />

      {needsReview.length > 0 && (
        <Notice tone="error">
          Pengembalian dana gagal untuk Kamar {needsReview.map((r) => r.roomNumber).join(', ')}. Dana penyewa belum kembali, jadi mohon hubungi KoBo agar segera ditinjau.
        </Notice>
      )}

      <RoomOccupancyBoard
        kosName={selectedKos.name}
        rooms={rooms}
        busyRoomId={busyRoomId}
        filterStatus={statusFilter}
        onFilterStatusChange={setStatusFilter}
        onOpenWhatsApp={setWhatsAppTargetRoom}
        onMarkPaid={pay}
        onEndTenancy={askEnd}
      />

      {payingRoom?.invoice && (
        <ManualPaymentModal
          room={payingRoom}
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
