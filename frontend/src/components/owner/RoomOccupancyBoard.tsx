import React, { useState } from 'react';
import { MessageSquare, FileText, UserPlus, CheckCircle2, Clock, AlertTriangle, AlertCircle, Sparkles, Filter, ChevronRight } from 'lucide-react';
import { Room, RoomStatus, Kos } from '../../types';
import { RoomStatusBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useAppStore } from '../../store/AppContext';

interface RoomOccupancyBoardProps {
  kos: Kos;
  onOpenWhatsApp: (room: Room) => void;
  onOpenKuitansi: (room: Room) => void;
  onFastIntake: (room: Room) => void;
}

export const RoomOccupancyBoard: React.FC<RoomOccupancyBoardProps> = ({
  kos,
  onOpenWhatsApp,
  onOpenKuitansi,
  onFastIntake,
}) => {
  const { updateRoomStatus } = useAppStore();
  const [filterStatus, setFilterStatus] = useState<RoomStatus | 'all'>('all');
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const filteredRooms = kos.rooms.filter((room) => {
    const matchesStatus = filterStatus === 'all' || room.status === filterStatus;
    const matchesFloor = selectedFloor === 'all' || room.floor === selectedFloor;
    return matchesStatus && matchesFloor;
  });

  const getStatusBorderAndBg = (status: RoomStatus) => {
    switch (status) {
      case 'paid':
        return {
          bg: 'var(--status-paid-bg)',
          border: 'var(--status-paid-border)',
          accent: 'var(--status-paid)',
        };
      case 'due':
        return {
          bg: 'var(--status-due-bg)',
          border: 'var(--status-due-border)',
          accent: 'var(--status-due)',
        };
      case 'overdue':
        return {
          bg: 'var(--status-overdue-bg)',
          border: 'var(--status-overdue-border)',
          accent: 'var(--status-overdue)',
        };
      case 'vacant':
        return {
          bg: 'var(--status-vacant-bg)',
          border: 'var(--status-vacant-border)',
          accent: 'var(--status-vacant)',
        };
      case 'booking':
        return {
          bg: 'var(--status-booking-bg)',
          border: 'var(--status-booking-border)',
          accent: 'var(--status-booking)',
        };
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        padding: '1.5rem',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Board Header & Filters */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
              Peta Okupansi & Status Kamar
            </h3>
            <span
              style={{
                backgroundColor: 'var(--primary-light)',
                color: 'var(--primary)',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '0.2rem 0.55rem',
                borderRadius: 'var(--radius-badge)',
              }}
            >
              {kos.rooms.length} Total Kamar
            </span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            Pantau status pembayaran sewa real-time, kirim tagihan WhatsApp santun, dan terbitkan kuitansi digital.
          </p>
        </div>

        {/* Filter Status Chips */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {(
            [
              { id: 'all', label: 'Semua Status' },
              { id: 'paid', label: '🟢 Lunas' },
              { id: 'due', label: '🟡 Jatuh Tempo' },
              { id: 'overdue', label: '🔴 Menunggak' },
              { id: 'vacant', label: '⚪ Kosong' },
              { id: 'booking', label: '🔵 Booking' },
            ] as const
          ).map((item) => {
            const isActive = filterStatus === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setFilterStatus(item.id)}
                className="interactive-tap"
                style={{
                  padding: '0.3rem 0.65rem',
                  borderRadius: 'var(--radius-badge)',
                  fontSize: '0.785rem',
                  fontWeight: isActive ? 700 : 500,
                  backgroundColor: isActive ? 'var(--text-main)' : 'var(--bg-muted)',
                  color: isActive ? 'white' : 'var(--text-muted)',
                  border: '1px solid',
                  borderColor: isActive ? 'var(--text-main)' : 'var(--border-subtle)',
                  transition: 'all var(--duration-fast) var(--ease-out-spring)',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Visual Room Grid (5-Color Responsive Matrix) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '1rem',
        }}
      >
        {filteredRooms.map((room) => {
          const colors = getStatusBorderAndBg(room.status);

          return (
            <div
              key={room.id}
              className="card-hover-lift"
              style={{
                backgroundColor: colors.bg,
                border: `1.5px solid ${colors.border}`,
                borderRadius: 'var(--radius-md)',
                padding: '1.125rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: '190px',
                position: 'relative',
              }}
            >
              {/* Room Top Bar */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      style={{
                        fontSize: '1.2rem',
                        fontWeight: 800,
                        color: 'var(--text-main)',
                        lineHeight: 1,
                      }}
                    >
                      Kamar {room.roomNumber}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                      (Lt. {room.floor})
                    </span>
                  </div>

                  <RoomStatusBadge status={room.status} size="sm" />
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.65rem' }}>
                  {room.roomType} · {room.size} · {formatRupiah(room.priceMonthly)}/bln
                </div>

                {/* Tenant Information or Vacant Notice */}
                {room.status !== 'vacant' ? (
                  <div
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.7)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.6rem 0.75rem',
                      fontSize: '0.8rem',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                      {room.tenantName || 'Penghuni Aktif'}
                    </div>
                    {room.tenantCampus && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                        🎓 {room.tenantCampus}
                      </div>
                    )}

                    {/* Due Date & Overdue Days */}
                    <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                        Jatuh Tempo: {room.dueDate || 'Tanggal 5'}
                      </span>
                      {room.daysOverdue && room.daysOverdue > 0 && (
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            color: 'var(--status-overdue)',
                            backgroundColor: 'white',
                            padding: '0.1rem 0.4rem',
                            borderRadius: 'var(--radius-xs)',
                          }}
                        >
                          Telat {room.daysOverdue} Hari
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.6)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.85rem 0.75rem',
                      textAlign: 'center',
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    Kamar ini sedang kosong dan siap disewa mahasiswa.
                  </div>
                )}
              </div>

              {/* Bottom Actions based on Room Status */}
              <div
                style={{
                  marginTop: '0.85rem',
                  paddingTop: '0.65rem',
                  borderTop: '1px solid rgba(0,0,0,0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                }}
              >
                {/* Status Quick Switcher */}
                <select
                  value={room.status}
                  onChange={(e) => updateRoomStatus(kos.id, room.id, e.target.value as RoomStatus)}
                  style={{
                    fontSize: '0.72rem',
                    padding: '0.25rem 0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-strong)',
                    backgroundColor: 'white',
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                  }}
                  aria-label="Ubah status kamar"
                >
                  <option value="paid">Ubah: Lunas</option>
                  <option value="due">Ubah: Jatuh Tempo</option>
                  <option value="overdue">Ubah: Menunggak</option>
                  <option value="vacant">Ubah: Kosong</option>
                  <option value="booking">Ubah: Booking</option>
                </select>

                {/* Primary Action Button */}
                {(room.status === 'overdue' || room.status === 'due') && (
                  <button
                    onClick={() => onOpenWhatsApp(room)}
                    className="interactive-tap"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.35rem 0.7rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      backgroundColor: '#25D366',
                      color: 'white',
                      border: 'none',
                    }}
                  >
                    <MessageSquare size={13} />
                    <span>Tagih WA</span>
                  </button>
                )}

                {room.status === 'paid' && (
                  <button
                    onClick={() => onOpenKuitansi(room)}
                    className="interactive-tap"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.35rem 0.7rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      backgroundColor: 'var(--primary)',
                      color: 'white',
                      border: 'none',
                    }}
                  >
                    <FileText size={13} />
                    <span>Kuitansi</span>
                  </button>
                )}

                {room.status === 'vacant' && (
                  <button
                    onClick={() => onFastIntake(room)}
                    className="interactive-tap"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.35rem 0.7rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      backgroundColor: 'var(--text-main)',
                      color: 'white',
                      border: 'none',
                    }}
                  >
                    <UserPlus size={13} />
                    <span>Check-in</span>
                  </button>
                )}

                {room.status === 'booking' && (
                  <button
                    onClick={() => updateRoomStatus(kos.id, room.id, 'paid')}
                    className="interactive-tap"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.35rem 0.7rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      backgroundColor: 'var(--status-booking)',
                      color: 'white',
                      border: 'none',
                    }}
                  >
                    <CheckCircle2 size={13} />
                    <span>Aktivasi Lunas</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
