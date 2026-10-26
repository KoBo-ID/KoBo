import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, FileText, CheckCircle2, MoreHorizontal } from 'lucide-react';
import type { BoardRoom } from '../../../../backend/src/trpc/router';
import { RoomStatus } from '../../types';
import { Popover } from '../ui/Popover';
import { formatDueDate, formatRupiah } from '../../lib/ownerWorkspace';

export const STATUS_META: Record<RoomStatus, { label: string; dot: string }> = {
  paid: { label: 'Lunas', dot: 'var(--status-paid)' },
  due: { label: 'Jatuh tempo', dot: 'var(--status-due)' },
  overdue: { label: 'Menunggak', dot: 'var(--status-overdue)' },
  vacant: { label: 'Kosong', dot: 'var(--status-vacant)' },
  booking: { label: 'Dipesan', dot: 'var(--status-booking)' },
};

const STATUS_ORDER: RoomStatus[] = ['paid', 'due', 'overdue', 'vacant', 'booking'];
const COLUMN_COUNT = 6;

interface RoomOccupancyBoardProps {
  kosName: string;
  rooms: BoardRoom[];
  /** The room whose payment or move-out request is in flight; its actions are disabled. */
  busyRoomId?: string | null;
  onOpenWhatsApp: (room: BoardRoom) => void;
  onMarkPaid: (room: BoardRoom) => void;
  onEndTenancy: (room: BoardRoom) => void;
  /** Optional controlled status filter (the dashboard KPI tiles drive it). */
  filterStatus?: RoomStatus | 'all';
  onFilterStatusChange?: (status: RoomStatus | 'all') => void;
}

/** Owner-safe payment labels. Xendit collection is "terverifikasi"; nothing here claims funds were paid out. */
const PAYMENT_LABEL: Record<string, string | null> = {
  AWAITING_ONLINE: 'Penyewa sedang membayar online',
  VERIFIED: 'Pembayaran terverifikasi',
  MANUAL: 'Dicatat manual',
  REFUND_PENDING: 'Dana penyewa sedang dikembalikan',
  REFUNDED: 'Dana penyewa telah dikembalikan',
  NEEDS_REVIEW: 'Pengembalian dana gagal, perlu ditinjau',
  NONE: null,
};

export const RoomOccupancyBoard: React.FC<RoomOccupancyBoardProps> = ({
  kosName,
  rooms,
  busyRoomId,
  onOpenWhatsApp,
  onMarkPaid,
  onEndTenancy,
  filterStatus: controlledStatus,
  onFilterStatusChange,
}) => {
  const [internalStatus, setInternalStatus] = useState<RoomStatus | 'all'>('all');
  const [selectedFloor, setSelectedFloor] = useState<number | 'all'>('all');

  const filterStatus = controlledStatus ?? internalStatus;
  const setFilterStatus = onFilterStatusChange ?? setInternalStatus;

  const floors = Array.from(new Set(rooms.map((r) => r.floor))).sort((a, b) => a - b);

  const filteredRooms = rooms.filter((room) => {
    const matchesStatus = filterStatus === 'all' || room.status === filterStatus;
    const matchesFloor = selectedFloor === 'all' || room.floor === selectedFloor;
    return matchesStatus && matchesFloor;
  });

  const visibleFloors = floors.filter((f) => filteredRooms.some((r) => r.floor === f));

  const countFor = (status: RoomStatus | 'all') =>
    status === 'all' ? rooms.length : rooms.filter((r) => r.status === status).length;

  const statusFilters: { id: RoomStatus | 'all'; label: string }[] = [
    { id: 'all', label: 'Semua' },
    ...STATUS_ORDER.map((s) => ({ id: s, label: STATUS_META[s].label })),
  ];

  const countStyle: React.CSSProperties = {
    // Darker than --text-muted: the segmented buttons sit on --bg-muted, where muted measures 4.2:1.
    color: 'hsl(215, 19%, 36%)',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
  };

  const statusClass = (s: RoomStatus) => (s === 'vacant' ? 'kobo-status kobo-status--hollow' : 'kobo-status');

  const btnClass = 'kobo-icon-btn kobo-icon-btn--sm kobo-icon-btn--ghost';

  /** The one-click action beside the status. Vacant rooms have none: a room fills through a real booking. */
  const renderPrimaryAction = (room: BoardRoom) => {
    const busy = busyRoomId === room.id;
    switch (room.status) {
      case 'overdue':
      case 'due':
        return (
          <button
            type="button"
            className={btnClass}
            aria-label={`Kirim tagihan WhatsApp Kamar ${room.roomNumber}`}
            title="Kirim tagihan WhatsApp"
            onClick={() => onOpenWhatsApp(room)}
          >
            <MessageSquare size={15} />
          </button>
        );
      case 'paid':
        return room.lastReceipt ? (
          <Link
            to={`/kuitansi/${room.lastReceipt.receiptNumber}`}
            className={btnClass}
            aria-label={`Lihat kuitansi Kamar ${room.roomNumber}`}
            title="Kuitansi"
          >
            <FileText size={15} />
          </Link>
        ) : null;
      case 'booking':
        return room.invoice ? (
          <button
            type="button"
            className={btnClass}
            disabled={busy || room.payment?.state === 'AWAITING_ONLINE'}
            aria-label={`Tandai Lunas Kamar ${room.roomNumber}`}
            title={room.payment?.state === 'AWAITING_ONLINE' ? 'Penyewa sedang membayar online. Tunggu sesi pembayaran berakhir.' : 'Tandai Lunas dan aktifkan sewa'}
            onClick={() => onMarkPaid(room)}
          >
            <CheckCircle2 size={15} />
          </button>
        ) : null;
      default:
        return null;
    }
  };

  return (
    <section aria-labelledby="room-board-title" className="od-board" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h2 id="room-board-title" style={{ fontSize: '1.15rem', fontWeight: 700 }}>
            Status Kamar <span style={{ ...countStyle, fontSize: '0.875rem', marginLeft: '0.25rem' }}>{rooms.length}</span>
          </h2>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {floors.length > 1 && (
            <div className="kobo-segmented" role="group" aria-label="Filter lantai">
              <button type="button" aria-pressed={selectedFloor === 'all'} onClick={() => setSelectedFloor('all')}>
                Semua Lantai
              </button>
              {floors.map((f) => (
                <button key={f} type="button" aria-pressed={selectedFloor === f} onClick={() => setSelectedFloor(f)}>
                  Lt. {f}
                </button>
              ))}
            </div>
          )}

          <div className="kobo-segmented" role="group" aria-label="Filter status kamar" style={{ flexWrap: 'wrap' }}>
            {statusFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={filterStatus === item.id}
                onClick={() => setFilterStatus(item.id)}
              >
                {item.label}
                <span style={countStyle}>{countFor(item.id)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="kobo-table-wrap">
        <table className="kobo-table kobo-table--stack" role="table">
          <caption className="od-sr">
            Daftar kamar {kosName} per lantai beserta penghuni, jatuh tempo, dan status pembayaran.
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Kamar</th>
              <th role="columnheader" scope="col" className="kobo-table__right">Harga</th>
              <th role="columnheader" scope="col">Penghuni</th>
              <th role="columnheader" scope="col">Jatuh tempo</th>
              <th role="columnheader" scope="col">Status</th>
              <th role="columnheader" scope="col" className="kobo-table__right">Aksi</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {filteredRooms.length === 0 && (
              <tr role="row">
                <td role="cell" colSpan={COLUMN_COUNT} className="kobo-table__empty">
                  Tidak ada kamar yang cocok dengan filter ini.
                </td>
              </tr>
            )}

            {visibleFloors.map((floor) => (
              <React.Fragment key={floor}>
                <tr role="row" className="kobo-table__group">
                  <th role="rowheader" colSpan={COLUMN_COUNT} scope="colgroup">Lantai {floor}</th>
                </tr>
                {filteredRooms
                  .filter((r) => r.floor === floor)
                  .map((room) => {
                    const isVacant = room.status === 'vacant';
                    const late = room.daysOverdue;
                    return (
                      <tr role="row" key={room.id}>
                        <td role="cell" data-cell="room">
                          <div className="kobo-table__strong">Kamar {room.roomNumber}</div>
                          <div className="kobo-table__muted" style={{ fontSize: '0.75rem' }}>
                            {room.type} · {room.size}
                          </div>
                        </td>
                        <td role="cell" data-cell="price" className="kobo-table__num kobo-table__right">{formatRupiah(room.priceMonthly)}</td>
                        <td role="cell" data-cell="tenant">
                          {isVacant ? (
                            <span className="kobo-table__muted" aria-label="Belum ada penghuni">&mdash;</span>
                          ) : (
                            <>
                              <div className="kobo-table__strong">{room.tenant?.name || 'Penghuni aktif'}</div>
                              {room.tenant?.campus && (
                                <div className="kobo-table__muted" style={{ fontSize: '0.75rem' }}>
                                  {room.tenant.campus}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td role="cell" data-cell="due">
                          {isVacant ? (
                            <span className="kobo-table__muted" aria-label="Tidak ada jatuh tempo">&mdash;</span>
                          ) : (
                            <>
                              <span className="kobo-table__num">{formatDueDate(room.invoice?.dueDate)}</span>
                              {late > 0 && (
                                <div style={{ color: 'var(--status-overdue-text)', fontSize: '0.75rem', fontWeight: 700 }}>
                                  Telat {late} hari
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td role="cell" data-cell="status">
                          <span className={statusClass(room.status)} style={{ ['--dot' as string]: STATUS_META[room.status].dot }}>
                            <span className="kobo-status__dot" aria-hidden="true" />
                            {STATUS_META[room.status].label}
                          </span>
                          {PAYMENT_LABEL[room.payment?.state ?? 'NONE'] && (
                            <div className="kobo-table__muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }} data-testid="payment-label">
                              {PAYMENT_LABEL[room.payment?.state ?? 'NONE']}
                            </div>
                          )}
                        </td>
                        <td role="cell" data-cell="actions">
                          <div className="kobo-table__actions">
                            {renderPrimaryAction(room)}
                            {!isVacant && (
                              <Popover
                                role="menu"
                                label={`Aksi Kamar ${room.roomNumber}`}
                                panelClassName="kobo-menu"
                                trigger={(p) => (
                                  <button
                                    {...p}
                                    type="button"
                                    className="kobo-icon-btn kobo-icon-btn--sm kobo-icon-btn--ghost"
                                    aria-label={`Aksi lainnya Kamar ${room.roomNumber}`}
                                    title="Aksi lainnya"
                                  >
                                    <MoreHorizontal size={15} />
                                  </button>
                                )}
                              >
                                {({ close }) => (
                                  <>
                                    {room.invoice && (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        disabled={busyRoomId === room.id || room.payment?.state === 'AWAITING_ONLINE'}
                                        onClick={() => {
                                          onMarkPaid(room);
                                          close();
                                        }}
                                      >
                                        Tandai Lunas
                                      </button>
                                    )}
                                    {(room.status === 'due' || room.status === 'overdue') && (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          onOpenWhatsApp(room);
                                          close();
                                        }}
                                      >
                                        Kirim Tagihan WhatsApp
                                      </button>
                                    )}
                                    {room.lastReceipt && (
                                      <Link to={`/kuitansi/${room.lastReceipt.receiptNumber}`} role="menuitem" className="kobo-menu__link" onClick={close}>
                                        Lihat Kuitansi
                                      </Link>
                                    )}
                                    <div className="kobo-menu__sep" role="separator" />
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={busyRoomId === room.id}
                                      style={{ color: 'var(--status-overdue-text)' }}
                                      onClick={() => {
                                        onEndTenancy(room);
                                        close();
                                      }}
                                    >
                                      {room.status === 'booking' ? 'Batalkan Pesanan' : 'Akhiri Sewa'}
                                    </button>
                                  </>
                                )}
                              </Popover>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
