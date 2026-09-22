import React, { useState } from 'react';
import {
  Building2,
  Users,
  DollarSign,
  AlertCircle,
  Plus,
  FileText,
  MessageSquare,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  UserPlus,
} from 'lucide-react';
import { useAppStore } from '../../store/AppContext';
import { RoomOccupancyBoard } from '../../components/owner/RoomOccupancyBoard';
import { WhatsAppModal } from '../../components/owner/WhatsAppModal';
import { KuitansiModal } from '../../components/owner/KuitansiModal';
import { KosFormModal } from '../../components/owner/KosFormModal';
import { Room, Kos, RoomStatus } from '../../types';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';

export const OwnerDashboard: React.FC = () => {
  const {
    kosList,
    selectedOwnerKosId,
    updateRoomStatus,
    addToast,
  } = useAppStore();

  const selectedKos = kosList.find((k) => k.id === selectedOwnerKosId) || kosList[0];

  // Modals state
  const [whatsAppTargetRoom, setWhatsAppTargetRoom] = useState<Room | null>(null);
  const [kuitansiTargetRoom, setKuitansiTargetRoom] = useState<Room | null>(null);
  const [fastIntakeTargetRoom, setFastIntakeTargetRoom] = useState<Room | null>(null);
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

      {/* Operational KPI Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1.25rem',
          marginBottom: '2rem',
        }}
      >
        {/* KPI 1: Okupansi */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            padding: '1.35rem',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block' }}>
              Tingkat Okupansi Kamar
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.35rem' }}>
              <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {occupiedRooms} / {totalRooms}
              </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 700 }}>
                ({occupancyPercentage}%)
              </span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.2rem', display: 'block' }}>
              {selectedKos.availableRooms} kamar kosong siap huni
            </span>
          </div>

          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              backgroundColor: 'var(--primary-light)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Users size={22} />
          </div>
        </div>

        {/* KPI 2: Total Pendapatan Lunas */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            padding: '1.35rem',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block' }}>
              Sewa Terkumpul (Bulan Ini)
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.35rem' }}>
              <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--status-paid)' }}>
                {formatRupiah(totalRevenueCollected)}
              </span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.2rem', display: 'block' }}>
              Dari {paidRooms.length} kamar berstatus Lunas
            </span>
          </div>

          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              backgroundColor: 'var(--status-paid-bg)',
              color: 'var(--status-paid)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <DollarSign size={22} />
          </div>
        </div>

        {/* KPI 3: Piutang Menunggak */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            padding: '1.35rem',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block' }}>
              Piutang Belum Terbayar
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.35rem' }}>
              <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--status-overdue)' }}>
                {formatRupiah(totalOverdueReceivables)}
              </span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.2rem', display: 'block' }}>
              {overdueRooms.length} kamar terlambat bayar
            </span>
          </div>

          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              backgroundColor: 'var(--status-overdue-bg)',
              color: 'var(--status-overdue)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AlertCircle size={22} />
          </div>
        </div>
      </div>

      {/* Main Feature: Interactive 5-Color Room Board */}
      <RoomOccupancyBoard
        kos={selectedKos}
        onOpenWhatsApp={(room) => setWhatsAppTargetRoom(room)}
        onOpenKuitansi={(room) => setKuitansiTargetRoom(room)}
        onFastIntake={(room) => setFastIntakeTargetRoom(room)}
      />

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
