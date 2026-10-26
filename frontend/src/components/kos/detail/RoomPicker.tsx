import React from 'react';
import { Check } from 'lucide-react';
import { Room } from '../../../types';
import { formatRupiah } from '../../../lib/format';

interface RoomPickerProps {
  rooms: Room[];
  selectedRoom: Room;
  onSelectRoom: (room: Room) => void;
  /** A type with no bookable room was clicked: the student wants its daftar tunggu. */
  onSelectFullType?: (roomType: string) => void;
}

export const RoomPicker: React.FC<RoomPickerProps> = ({
  rooms,
  selectedRoom,
  onSelectRoom,
  onSelectFullType,
}) => {
  const grouped = rooms.reduce((acc, room) => {
    if (!acc[room.roomType]) acc[room.roomType] = [];
    acc[room.roomType].push(room);
    return acc;
  }, {} as Record<string, Room[]>);
  const groupEntries = Object.entries(grouped);
  const headingId = React.useId();

  return (
    <section className="room-picker" aria-labelledby={headingId}>
      <div className="room-picker__heading">
        <h3 id={headingId} className="section-title">Pilihan tipe kamar & ketersediaan</h3>
        <span>{groupEntries.length} tipe kamar</span>
      </div>
      <div className="room-picker__grid">
        {groupEntries.map(([roomType, groupRooms]) => {
          // A live offer to someone else is not bookable; the viewer's own offer comes first.
          const vacantRooms = groupRooms
            .filter((r) => r.status === 'vacant' && !r.reservedForWaitlist)
            .sort((a, b) => Number(!!b.offeredToMe) - Number(!!a.offeredToMe));
          const shown = vacantRooms[0] ?? groupRooms[0];
          const reservedCount = groupRooms.filter((r) => r.reservedForWaitlist).length;
          const vacantCount = vacantRooms.length;
          const isAvailable = vacantCount > 0;
          const isSelected = isAvailable && selectedRoom.roomType === roomType;

          return (
            <button
              key={roomType}
              type="button"
              className={`room-picker__option${isSelected ? ' is-selected' : ''}${!isAvailable ? ' is-full' : ''}`}
              aria-pressed={isAvailable ? isSelected : undefined}
              disabled={!isAvailable && !onSelectFullType}
              onClick={() => {
                if (isAvailable) onSelectRoom(vacantRooms[0]);
                else onSelectFullType?.(roomType);
              }}
            >
              <span className="room-picker__main">
                <span className="room-picker__title">
                  <span>{roomType}</span>
                  {isSelected && <span className="room-picker__chosen"><Check size={13} strokeWidth={3} aria-hidden="true" />Dipilih</span>}
                </span>
                <span className="room-picker__availability">
                  <span>{vacantCount} dari {groupRooms.length}</span> kamar tersedia
                </span>
                <span className="room-picker__details">
                  <span>Ukuran: {shown.size}</span>
                  <span>Kasur: {shown.bedType}</span>
                </span>
                {reservedCount > 0 && (
                  <span className="room-picker__reserved">
                    Dipesan antrean{reservedCount > 1 ? ` (${reservedCount})` : ''}
                  </span>
                )}
              </span>
              <span className="room-picker__footer">
                <span className="room-picker__price">
                  {formatRupiah(shown.priceMonthly)} <span>/bln</span>
                </span>
                {!isAvailable && onSelectFullType && (
                  <span className="room-picker__waitlist">Ikut daftar tunggu</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
