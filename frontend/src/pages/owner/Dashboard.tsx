import React, { useState } from 'react';
import { Users, DollarSign, AlertCircle, Plus, MessageSquare, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../../store/AppContext';
import { RoomOccupancyBoard, formatDueDate } from '../../components/owner/RoomOccupancyBoard';
import { WhatsAppModal } from '../../components/owner/WhatsAppModal';
import { KuitansiModal } from '../../components/owner/KuitansiModal';
import { KosFormModal } from '../../components/owner/KosFormModal';
import { Room, RoomStatus } from '../../types';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';

export const OwnerDashboard: React.FC = () => {
  const {
    kosList,
    selectedOwnerKosId,
    updateRoomStatus,
  } = useAppStore();

  const selectedKos = kosList.find((k) => k.id === selectedOwnerKosId) || kosList[0];

  // Modals state
  const [whatsAppTargetRoom, setWhatsAppTargetRoom] = useState<Room | null>(null);
  const [kuitansiTargetRoom, setKuitansiTargetRoom] = useState<Room | null>(null);
  const [fastIntakeTargetRoom, setFastIntakeTargetRoom] = useState<Room | null>(null);
  const [statusFilter, setStatusFilter] = useState<RoomStatus | 'all'>('all');
  const [isAddKosModalOpen, setIsAddKosModalOpen] = useState(false);

  // Fast intake form state
  const [intakeName, setIntakeName] = useState('');
  const [intakePhone, setIntakePhone] = useState('');
  const [intakeCampus, setIntakeCampus] = useState('');

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  // Operational KPI calculations
  const totalRooms = selectedKos.rooms.length;
  const occupiedRooms = selectedKos.rooms.filter((r) => r.status !== 'vacant').length;
  const occupancyPercentage = Math.round((occupiedRooms / totalRooms) * 100) || 0;

  const paidRooms = selectedKos.rooms.filter((r) => r.status === 'paid');
  const totalRevenueCollected = paidRooms.reduce((acc, r) => acc + r.priceMonthly, 0);

  const overdueRooms = selectedKos.rooms.filter((r) => r.status === 'overdue');
  const totalOverdueReceivables = overdueRooms.reduce((acc, r) => acc + r.priceMonthly, 0);

  const attentionRooms = selectedKos.rooms
    .filter((r) => r.status === 'overdue' || r.status === 'due')
    .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));

  const kpiTiles: {
    filter: RoomStatus | 'all';
    label: string;
    icon: React.ReactNode;
    value: string;
    meta: string;
    rail?: number;
  }[] = [
    {
      filter: 'all',
      label: 'Tingkat Okupansi',
      icon: <Users size={14} />,
      value: `${occupiedRooms} / ${totalRooms} (${occupancyPercentage}%)`,
      meta: `${selectedKos.availableRooms} kamar kosong siap huni`,
      rail: occupancyPercentage,
    },
    {
      filter: 'paid',
      label: 'Sewa Terkumpul (Bulan Ini)',
      icon: <DollarSign size={14} />,
      value: formatRupiah(totalRevenueCollected),
      meta: `Dari ${paidRooms.length} kamar berstatus Lunas`,
    },
    {
      filter: 'overdue',
      label: 'Piutang Belum Terbayar',
      icon: <AlertCircle size={14} />,
      value: formatRupiah(totalOverdueReceivables),
      meta: `${overdueRooms.length} kamar terlambat bayar`,
    },
  ];

  const handleExecuteIntake = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fastIntakeTargetRoom) return;

    updateRoomStatus(selectedKos.id, fastIntakeTargetRoom.id, 'paid', {
      name: intakeName,
      phone: intakePhone,
      campus: intakeCampus,
      dueDate: '2026-10-05',
    });

    setIntakeName('');
    setIntakePhone('');
    setIntakeCampus('');
    setFastIntakeTargetRoom(null);
  };

  /* Urgent work goes above the table so it is the first thing seen; when
     there is nothing to chase it drops below, where a reassuring empty state
     belongs rather than occupying the top of the screen. */
  const hasAttention = attentionRooms.length > 0;
  const attentionSection = (
        <section aria-labelledby="attention-title" style={hasAttention ? { marginBottom: '2rem' } : { marginTop: '2rem' }}>
          <h2 id="attention-title" style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.75rem' }}>
            Perlu Perhatian
          </h2>
          {attentionRooms.length === 0 ? (
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
                    {room.tenantName || 'Penghuni Aktif'}
                    {' · '}
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatRupiah(room.priceMonthly)}</span>
                    {' · '}
                    <span style={{ color: 'var(--text-muted)' }}>Jatuh tempo {formatDueDate(room.dueDate)}</span>
                    {room.daysOverdue && room.daysOverdue > 0 ? (
                      <span style={{ color: 'var(--status-overdue)', fontWeight: 700 }}>
                        {' '}(Telat {room.daysOverdue} hari)
                      </span>
                    ) : null}
                  </span>
                  <span style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<MessageSquare size={14} />}
                      onClick={() => setWhatsAppTargetRoom(room)}
                    >
                      Kirim Tagihan WhatsApp
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<CheckCircle2 size={14} />}
                      onClick={() => updateRoomStatus(selectedKos.id, room.id, 'paid')}
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

  return (
    <div className="app-container" style={{ maxWidth: '1180px', paddingTop: '2rem', paddingBottom: '4rem' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1.25rem',
          marginBottom: '2rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                backgroundColor: 'var(--primary-light)',
                color: 'var(--primary)',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '0.2rem 0.55rem',
                borderRadius: 'var(--radius-badge)',
                textTransform: 'uppercase',
              }}
            >
              Dashboard Pemilik Kos
            </span>
          </div>

          <h1 style={{ fontSize: '2.1rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.35rem' }}>
            Papan Okupansi &amp; Keuangan Kos
          </h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            Kelola operasional kamar, pantau setoran sewa, dan kirim kuitansi resmi dalam satu layar.
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={() => setIsAddKosModalOpen(true)}
          icon={<Plus size={16} />}
        >
          Tambah Kos Baru
        </Button>
      </div>

      {/* KPI tiles: each one also filters the room table below */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
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
      </div>

      {hasAttention && attentionSection}

      <RoomOccupancyBoard
        kos={selectedKos}
        filterStatus={statusFilter}
        onFilterStatusChange={setStatusFilter}
        onOpenWhatsApp={(room) => setWhatsAppTargetRoom(room)}
        onOpenKuitansi={(room) => setKuitansiTargetRoom(room)}
        onFastIntake={(room) => setFastIntakeTargetRoom(room)}
      />

      {!hasAttention && attentionSection}



      {/* WhatsApp Reminder Modal */}
      {whatsAppTargetRoom && (
        <WhatsAppModal
          isOpen={!!whatsAppTargetRoom}
          onClose={() => setWhatsAppTargetRoom(null)}
          room={whatsAppTargetRoom}
          kos={selectedKos}
        />
      )}

      {/* Digital Kuitansi Modal */}
      {kuitansiTargetRoom && (
        <KuitansiModal
          isOpen={!!kuitansiTargetRoom}
          onClose={() => setKuitansiTargetRoom(null)}
          room={kuitansiTargetRoom}
          kos={selectedKos}
        />
      )}

      {/* Add New Kos Wizard Modal */}
      <KosFormModal
        isOpen={isAddKosModalOpen}
        onClose={() => setIsAddKosModalOpen(false)}
      />

      {/* Fast Tenant Intake Modal */}
      {fastIntakeTargetRoom && (
        <Modal
          isOpen={!!fastIntakeTargetRoom}
          onClose={() => setFastIntakeTargetRoom(null)}
          title={`Check-in Penghuni Baru: Kamar ${fastIntakeTargetRoom.roomNumber}`}
          subtitle={`Masukkan data mahasiswa yang menempati Kamar ${fastIntakeTargetRoom.roomNumber}`}
          maxWidth="sm"
        >
          <form onSubmit={handleExecuteIntake} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Input
              label="Nama Lengkap Mahasiswa"
              value={intakeName}
              onChange={(e) => setIntakeName(e.target.value)}
              placeholder="Contoh: Bima Sakti"
              required
            />
            <Input
              label="Nomor WhatsApp"
              value={intakePhone}
              onChange={(e) => setIntakePhone(e.target.value)}
              placeholder="081298765431"
              required
            />
            <Input
              label="Asal Kampus & Jurusan"
              value={intakeCampus}
              onChange={(e) => setIntakeCampus(e.target.value)}
              placeholder="Binus Syahdan (Informatika)"
              required
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <Button type="button" variant="ghost" size="sm" onClick={() => setFastIntakeTargetRoom(null)}>
                Batal
              </Button>
              <Button type="submit" variant="primary" size="sm" icon={<CheckCircle2 size={16} />}>
                Konfirmasi Check-in & Set Lunas
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
