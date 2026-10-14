import '../../styles/owner-dashboard.css';
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Users, Wallet, AlertCircle, AlertTriangle, MessageSquare, CheckCircle2, Hourglass } from 'lucide-react';
import type { BoardRoom } from '../../../../backend/src/trpc/router';
import { RoomOccupancyBoard } from '../../components/owner/RoomOccupancyBoard';
import { ApplicationsPanel } from '../../components/owner/ApplicationsPanel';
import { VisitsPanel } from '../../components/owner/VisitsPanel';
import { ManualPaymentModal } from '../../components/owner/ManualPaymentModal';
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

const START_STEPS = [
  { title: 'Daftarkan kos', hint: 'Isi nama, alamat, fasilitas, dan foto.' },
  { title: 'Tambah kamar', hint: 'Atur tipe, ukuran, dan harga per bulan.' },
  { title: 'Terima pengajuan', hint: 'Calon penghuni mengajukan sewa, Anda yang memutuskan.' },
];

const DashboardSkeleton: React.FC = () => (
  <div className="app-container owner-page" role="status" aria-live="polite" aria-label="Memuat papan okupansi">
    <OwnerPageHeader title="Papan okupansi" />
    <div className="od-stats" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="od-stat" style={{ cursor: 'default' }}>
          <Skeleton width="60%" height="0.8rem" />
          <Skeleton width="80%" height="1.4rem" />
          <Skeleton width="70%" height="0.8rem" />
        </div>
      ))}
    </div>
    <div className="od-skel-list" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
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
          <p>Papan okupansi akan muncul di sini setelah Anda mendaftarkan kos pertama.</p>
          <ol className="od-steps">
            {START_STEPS.map((s) => (
              <li key={s.title}>
                <div>
                  <strong>{s.title}</strong>
                  <span>{s.hint}</span>
                </div>
              </li>
            ))}
          </ol>
          <Link to="/owner/kos">
            <Button variant="primary" size="md">Kelola properti</Button>
          </Link>
        </div>
      </div>
    );
  }
  if (board.isError) {
    return <ErrorState message="Gagal memuat papan kamar." onRetry={() => void board.refetch()} />;
  }
  // Wait for the visits too so the page lands in its final layout. A failed visits query does not block it.
  if (!board.data || visits.isPending) return <DashboardSkeleton />;

  const { rooms, summary } = board.data;
  const occupancyPercentage = Math.round((summary.occupiedRooms / summary.totalRooms) * 100) || 0;
  const attentionRooms = rooms
    .filter((r) => r.status === 'overdue' || r.status === 'due')
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const kpiTiles: { filter: RoomStatus | 'all'; label: string; icon: React.ReactNode; value: React.ReactNode; meta: string }[] = [
    {
      filter: 'all',
      label: 'Okupansi',
      icon: <Users size={14} aria-hidden="true" />,
      value: (
        <>
          {summary.occupiedRooms} dari {summary.totalRooms}
          <span className="od-stat__unit">{occupancyPercentage}%</span>
        </>
      ),
      meta: `${summary.counts.vacant} kamar kosong`,
    },
    {
      filter: 'paid',
      label: 'Terkumpul bulan ini',
      icon: <Wallet size={14} aria-hidden="true" />,
      value: formatRupiah(summary.collectedThisMonth),
      meta: `Target ${formatRupiah(summary.expectedThisMonth)}`,
    },
    {
      filter: 'overdue',
      label: 'Belum dibayar',
      icon: <AlertCircle size={14} aria-hidden="true" />,
      value: formatRupiah(summary.overdueAmount),
      meta: `${summary.counts.overdue} kamar terlambat`,
    },
  ];

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
  const confirmVerb = confirmingRoom?.status === 'booking' ? 'Batalkan booking' : 'Akhiri sewa';

  return (
    <div className="app-container owner-page">
      <OwnerPageHeader title="Papan okupansi" subtitle={selectedKos.name} />

      {/* Summary tiles: each one also filters the room table below */}
      <div className="od-stats">
        {kpiTiles.map((tile) => (
          <button
            key={tile.filter}
            type="button"
            className="od-stat"
            aria-pressed={statusFilter === tile.filter}
            onClick={() => setStatusFilter(tile.filter)}
          >
            <span className="od-stat__label">{tile.icon}{tile.label}</span>
            <span className="od-stat__value">{tile.value}</span>
            <span className="od-stat__meta">{tile.meta}</span>
          </button>
        ))}
        {/* Not a room filter: the queue lives in the property manager, so this tile links there. */}
        <Link to="/owner/kos" className="od-stat">
          <span className="od-stat__label"><Hourglass size={14} aria-hidden="true" />Daftar tunggu</span>
          <span className="od-stat__value">{summary.waitlistCount}<span className="od-stat__unit">pengantre</span></span>
          <span className="od-stat__meta">{summary.waitlistCount > 0 ? 'Dapat email saat kamar kosong' : 'Belum ada yang mengantre'}</span>
        </Link>
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
          </span>
          <span className="od-confirm__actions">
            <Button variant="outline" size="sm" onClick={cancelConfirm}>Batal</Button>
            <Button variant="danger" size="sm" onClick={doEnd}>{confirmVerb}</Button>
          </span>
        </div>
      )}

      <section aria-labelledby="attention-title" className="od-section">
        <h2 id="attention-title" className="od-section__title">
          {hasAttention && (
            // Amber while invoices are only due; red once any is actually late (same escalation as "Telat N hari").
            <AlertTriangle size={18} aria-hidden="true" color={attentionRooms.some((r) => r.daysOverdue > 0) ? 'var(--status-overdue)' : 'var(--status-due)'} />
          )}
          Perlu perhatian
          {hasAttention && <span className="od-count">{attentionRooms.length}</span>}
        </h2>
        {!hasAttention ? (
          <p className="od-empty">Semua kamar terbayar. Tagihan yang jatuh tempo atau terlambat akan muncul di sini.</p>
        ) : (
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
                  {room.daysOverdue > 0 ? <span className="od-row__late">Telat {room.daysOverdue} hari</span> : null}
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
        )}
      </section>

      <VisitsPanel kosId={selectedKos.id} promoted={hasVisitAttention} />

      <ApplicationsPanel kosId={selectedKos.id} />

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
