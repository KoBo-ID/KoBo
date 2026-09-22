import React from 'react';
import { Room } from '../../../types';

interface RoomPickerProps {
  rooms: Room[];
  selectedRoom: Room;
  onSelectRoom: (room: Room) => void;
}

export const RoomPicker: React.FC<RoomPickerProps> = ({
  rooms,
  selectedRoom,
  onSelectRoom,
}) => {
  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const grouped = rooms.reduce((acc, room) => {
    if (!acc[room.roomType]) acc[room.roomType] = [];
    acc[room.roomType].push(room);
    return acc;
  }, {} as Record<string, Room[]>);

  const groupEntries = Object.entries(grouped);

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border-subtle)',
        padding: '1.5rem',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
          Pilihan Tipe Kamar & Ketersediaan
        </h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {groupEntries.length} tipe kamar tersedia
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          alignItems: 'stretch',
        }}
      >
        {groupEntries.map(([roomType, groupRooms]) => {
          const firstRoom = groupRooms[0];
          const vacantRooms = groupRooms.filter((r) => r.status === 'vacant');
          const vacantCount = vacantRooms.length;
          const isAvailable = vacantCount > 0;
          const isSelected = selectedRoom.roomType === roomType;

          return (
            <div
              key={roomType}
              onClick={() => {
                if (isAvailable) {
                  onSelectRoom(vacantRooms[0]);
                }
              }}
              className="interactive-tap"
              style={{
                border: `1.5px solid ${isSelected ? 'var(--primary)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-sm)',
                padding: '1rem',
                backgroundColor: isSelected ? 'var(--primary-light)' : 'var(--bg-page)',
                cursor: isAvailable ? 'pointer' : 'not-allowed',
                opacity: isAvailable ? 1 : 0.6,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
                transition: 'all var(--duration-fast)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-main)' }}>
                  {roomType}
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.15rem 0.5rem',
                    borderRadius: 'var(--radius-badge)',
                    backgroundColor: isAvailable ? 'var(--status-paid-bg)' : 'var(--status-overdue-bg)',
                    color: isAvailable ? 'var(--status-paid)' : 'var(--status-overdue)',
                  }}
                >
                  {vacantCount} tersedia / {groupRooms.length} total
                </span>
              </div>

              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Ukuran: {firstRoom.size}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                Kasur: {firstRoom.bedType}
              </span>

              <div style={{ marginTop: 'auto', paddingTop: '0.35rem', fontWeight: 800, color: 'var(--primary)', fontSize: '0.95rem' }}>
                {formatRupiah(firstRoom.priceMonthly)}{' '}
                <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>/bln</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
