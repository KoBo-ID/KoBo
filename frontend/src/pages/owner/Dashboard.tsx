import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Users, DollarSign, AlertCircle, AlertTriangle, MessageSquare, CheckCircle2, Hourglass } from 'lucide-react';
import type { BoardRoom } from '../../../../backend/src/trpc/router';
import { RoomOccupancyBoard } from '../../components/owner/RoomOccupancyBoard';
import { VisitsPanel } from '../../components/owner/VisitsPanel';
import { WhatsAppModal } from '../../components/owner/WhatsAppModal';
import { RoomStatus } from '../../types';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/QueryState';
import { formatDueDate, formatRupiah, useOwnerWorkspace } from '../../lib/ownerWorkspace';
import { useRoomActions } from '../../lib/ownerActions';
import { useOwnerVisits } from '../../lib/visits';
import { useTRPC } from '../../lib/trpc';

export const OwnerDashboard: React.FC = () => {
  const { selectedKos } = useOwnerWorkspace();
  const trpc = useTRPC();
  const board = useQuery({ ...trpc.owner.board.queryOptions({ kosId: selectedKos?.id ?? '' }), enabled: !!selectedKos });
  const visits = useOwnerVisits(selectedKos?.id);
  const { busyRoomId, markPaid, endTenancy } = useRoomActions(selectedKos?.id);

  const [whatsAppTargetRoom, setWhatsAppTargetRoom] = useState<BoardRoom | null>(null);
  const [statusFilter, setStatusFilter] = useState<RoomStatus | 'all'>('all');

  if (!selectedKos) {
    return (
      <div className="app-container" style={{ maxWidth: '1180px', paddingTop: '3rem', paddingBottom: '4rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>Anda belum memiliki properti kos. Daftarkan kos pertama Anda untuk mulai memantau kamar.</p>
        <Link to="/owner/kos">
          <Button variant="primary" size="md">Kelola Properti Kos</Button>
        </Link>
      </div>
    );
  }
  if (board.isError) {
    return <ErrorState message="Gagal memuat papan kamar." onRetry={() => void board.refetch()} />;
  }
  // Wait for the visits too, so the survey section lands in its final place (above or below the board)
  // instead of pushing the board down once it arrives. A failed visits query does not block the page.
  if (!board.data || visits.isPending) {
    return (
      <div role="status" aria-live="polite" style={{ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Memuat papan kamar…</span>
      </div>
    );
  }

  const { rooms, summary } = board.data;
  const occupancyPercentage = Math.round((summary.occupiedRooms / summary.totalRooms) * 100) || 0;
  const attentionRooms = rooms
    .filter((r) => r.status === 'overdue' || r.status === 'due')
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const kpiTiles: { filter: RoomStatus | 'all'; label: string; icon: React.ReactNode; value: string; meta: string; rail?: number }[] = [
    {
      filter: 'all',
      label: 'Tingkat Okupansi',
      icon: <Users size={14} />,
      value: `${summary.occupiedRooms} / ${summary.totalRooms} (${occupancyPercentage}%)`,
      meta: `${summary.counts.vacant} kamar kosong siap huni`,
      rail: occupancyPercentage,
    },
    {
      filter: 'paid',
      label: 'Sewa Terkumpul (Bulan Ini)',
      icon: <DollarSign size={14} />,
      value: formatRupiah(summary.collectedThisMonth),
      meta: `Dari target ${formatRupiah(summary.expectedThisMonth)} bulan ini`,
    },
    {
      filter: 'overdue',
      label: 'Piutang Belum Terbayar',
      icon: <AlertCircle size={14} />,
      value: formatRupiah(summary.overdueAmount),
      meta: `${summary.counts.overdue} kamar terlambat bayar`,
    },
  ];

  const confirmEnd = (room: BoardRoom) => {
    const what = room.status === 'booking' ? 'Batalkan booking' : 'Akhiri sewa';
    if (room.tenancyId && window.confirm(`${what} Kamar ${room.roomNumber}?`)) void endTenancy(room.id, room.tenancyId);
  };
  const pay = (room: BoardRoom) => {
    if (room.invoice) void markPaid(room.id, room.invoice.id);
  };

  /* Urgent work goes above the table so it is the first thing seen; when
     there is nothing to chase it drops below, where a reassuring empty state
     belongs rather than occupying the top of the screen. */
  const hasAttention = attentionRooms.length > 0;
  const attentionSection = (
    <section aria-labelledby="attention-title" style={hasAttention ? { marginBottom: '2rem' } : { marginTop: '2rem' }}>
      <h2 id="attention-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.75rem' }}>
        {hasAttention && (
          // Amber while invoices are only due; red once any is actually late (same escalation as "Telat N hari").
          <AlertTriangle size={18} aria-hidden="true" color={attentionRooms.some((r) => r.daysOverdue > 0) ? 'var(--status-overdue)' : 'var(--status-due)'} />
        )}
        Perlu Perhatian
      </h2>
      {!hasAttention ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Semua kamar terbayar. Tidak ada tagihan yang perlu ditindaklanjuti.
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-card)',
            backgroundColor: 'var(--bg-surface)',
          }}
        >
          {attentionRooms.map((room, i) => (
            <li
              key={room.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.75rem',
                padding: '0.8rem 1rem',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                fontSize: '0.875rem',
              }}
            >
              <span>
                <strong>Kamar {room.roomNumber}</strong>
                {' · '}
                {room.tenant?.name || 'Penghuni Aktif'}
                {' · '}
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatRupiah(room.invoice?.amount ?? room.priceMonthly)}</span>
                {' · '}
                <span style={{ color: 'var(--text-muted)' }}>Jatuh tempo {formatDueDate(room.invoice?.dueDate)}</span>
                {room.daysOverdue > 0 ? (
                  <span style={{ color: 'var(--status-overdue)', fontWeight: 700 }}> (Telat {room.daysOverdue} hari)</span>
                ) : null}
              </span>
              <span style={{ display: 'flex', gap: '0.5rem' }}>
                <Button variant="outline" size="sm" icon={<MessageSquare size={14} />} onClick={() => setWhatsAppTargetRoom(room)}>
                  Kirim Tagihan WhatsApp
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon={<CheckCircle2 size={14} />}
                  disabled={busyRoomId === room.id}
                  aria-label={`Tandai Lunas Kamar ${room.roomNumber}`}
                  onClick={() => pay(room)}
                >
                  Tandai Lunas
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  /* Surveys follow the same rule as "Perlu Perhatian": a scheduled visit is something to act on (confirm, then
     mark done), so it goes above the board; with none waiting it drops below with a quiet empty state. */
  const hasVisitAttention = (visits.data ?? []).some((v) => v.status === 'SCHEDULED');
  const visitsSection = <VisitsPanel kosId={selectedKos.id} promoted={hasVisitAttention} />;

  return (
    <div className="app-container" style={{ maxWidth: '1180px', paddingTop: '2rem', paddingBottom: '4rem' }}>
      {/* KPI tiles: each one also filters the room table below */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {kpiTiles.map((tile) => (
          <button
            key={tile.filter}
            type="button"
            className="kobo-stat"
            aria-pressed={statusFilter === tile.filter}
            onClick={() => setStatusFilter(tile.filter)}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: 'inherit',
              borderColor: statusFilter === tile.filter ? 'var(--text-main)' : undefined,
            }}
          >
            <span className="kobo-stat__label">
              {tile.icon}
              {tile.label}
            </span>
            <span className="kobo-stat__value">{tile.value}</span>
            {tile.rail !== undefined && (
              <span className="kobo-stat__rail" aria-hidden="true">
                <span style={{ ['--pct' as string]: tile.rail + '%' }} />
              </span>
            )}
            <span className="kobo-stat__meta">{tile.meta}</span>
          </button>
        ))}
        {/* Not a room filter: the queue lives in the property manager, so this tile links there. */}
        <Link to="/owner/kos" className="kobo-stat" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="kobo-stat__label">
            <Hourglass size={14} />
            Daftar Tunggu
          </span>
          <span className="kobo-stat__value">{summary.waitlistCount} pengantre</span>
          <span className="kobo-stat__meta">{summary.waitlistCount > 0 ? 'Mereka dapat email saat kamar kosong' : 'Belum ada yang mengantre'}</span>
        </Link>
      </div>

      {hasAttention && attentionSection}
      {hasVisitAttention && visitsSection}

      <RoomOccupancyBoard
        kosName={selectedKos.name}
        rooms={rooms}
        busyRoomId={busyRoomId}
        filterStatus={statusFilter}
        onFilterStatusChange={setStatusFilter}
        onOpenWhatsApp={setWhatsAppTargetRoom}
        onMarkPaid={pay}
        onEndTenancy={confirmEnd}
      />

      {!hasAttention && attentionSection}
      {!hasVisitAttention && visitsSection}

      {whatsAppTargetRoom && (
        <WhatsAppModal isOpen onClose={() => setWhatsAppTargetRoom(null)} room={whatsAppTargetRoom} kosName={selectedKos.name} />
      )}
    </div>
  );
};
