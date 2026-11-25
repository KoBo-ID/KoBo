import React from 'react';
import { Users } from 'lucide-react';
import { Room } from '../../../types';
import { formatRupiah } from '../../../lib/format';

interface RoomPickerProps {
  rooms: Room[];
  selectedRoom: Room;
  onSelectRoom: (room: Room) => void;
  /** A type with no bookable room was clicked: the student wants its daftar tunggu. */
  onSelectFullType?: (roomType: string) => void;
  /** The viewer's live queue entry: a room type (or null = any type). Matching full types read "Anda sudah di daftar tunggu". */
  queued?: { roomType: string | null } | null;
}

export const RoomPicker: React.FC<RoomPickerProps> = ({
  rooms,
  selectedRoom,
  onSelectRoom,
  onSelectFullType,
  queued,
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
        <h2 id={headingId} className="section-title">Pilihan tipe kamar & ketersediaan</h2>
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
          const alreadyQueued = !isAvailable && !!queued && (queued.roomType === null || queued.roomType === roomType);

          return (
            <button
              key={roomType}
              type="button"
              className={`room-picker__option${isSelected ? ' is-selected' : ''}${!isAvailable ? ' is-full' : ''}`}
              aria-pressed={isAvailable ? isSelected : undefined}
              disabled={!isAvailable && (!onSelectFullType || alreadyQueued)}
              onClick={() => {
                if (isAvailable) onSelectRoom(vacantRooms[0]);
                else if (!alreadyQueued) onSelectFullType?.(roomType);
              }}
            >
              <span className="room-picker__main">
                <span className="room-picker__title">
                  <span>{roomType}</span>
                  {(shown.maxOccupants ?? 1) >= 2 && (
                    <span className="room-picker__capacity" title={`Muat ${shown.maxOccupants} orang`}>
                      <Users size={14} strokeWidth={2.25} aria-hidden="true" />
                      <span aria-hidden="true">{shown.maxOccupants}</span>
                      <span className="sr-only">Muat {shown.maxOccupants} orang</span>
                    </span>
                  )}
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
                  {formatRupiah(shown.priceMonthly)} <span>per kamar /bln</span>
                </span>
                {(shown.maxOccupants ?? 1) >= 2 && shown.pricePerPersonMonthly != null && (
                  <span className="room-picker__reserved" style={{ color: 'var(--text-muted)' }}>
                    {formatRupiah(shown.pricePerPersonMonthly)} per orang
                  </span>
                )}
                {alreadyQueued ? (
                  <span className="room-picker__reserved" style={{ color: 'var(--text-muted)' }}>Anda sudah di daftar tunggu</span>
                ) : (
                  !isAvailable && onSelectFullType && <span className="room-picker__waitlist">Ikut daftar tunggu</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
