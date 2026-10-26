import React from 'react';
import { Link } from 'react-router-dom';
import type { BoardRoom, BoardSummary } from '../../../../backend/src/trpc/router';
import type { RoomStatus } from '../../types';
import { formatRupiah } from '../../lib/ownerWorkspace';
import { STATUS_META } from './RoomOccupancyBoard';

const LEGEND_ORDER: RoomStatus[] = ['paid', 'due', 'overdue', 'booking', 'vacant'];

interface OwnerOverviewProps {
  rooms: BoardRoom[];
  summary: BoardSummary;
  /** Jump the room board to the late rooms. */
  onShowOverdue: () => void;
}

/**
 * The one panel on the dashboard: money this month beside the building. Only figures the board query returns.
 * The room map is display-only; the board below is where rooms are filtered and acted on.
 */
export const OwnerOverview: React.FC<OwnerOverviewProps> = ({ rooms, summary, onShowOverdue }) => {
  const { collectedThisMonth, expectedThisMonth, overdueAmount, counts, totalRooms, occupiedRooms, waitlistCount } = summary;
  const collectedPct = expectedThisMonth > 0 ? Math.min(100, Math.round((collectedThisMonth / expectedThisMonth) * 100)) : 0;
  const occupancyPct = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;
  const floors = Array.from(new Set(rooms.map((r) => r.floor))).sort((a, b) => a - b);

  return (
    <section className="od-hero" aria-label="Ringkasan bulan ini">
      <div className="od-money">
        <h2 className="od-eyebrow">Terkumpul bulan ini</h2>
        <p className="od-money__value">{formatRupiah(collectedThisMonth)}</p>
        {expectedThisMonth > 0 && (
          <>
            <div className="od-bar" role="img" aria-label={`${collectedPct}% dari ${formatRupiah(expectedThisMonth)}`}>
              <span style={{ width: `${collectedPct}%` }} />
            </div>
            <p className="od-money__meta">
              {collectedPct}% dari {formatRupiah(expectedThisMonth)} tagihan bulan ini
            </p>
          </>
        )}
        <dl className="od-facts">
          <div>
            <dt>Menunggak</dt>
            <dd>
              {overdueAmount > 0 ? (
                <button type="button" className="od-link od-link--late" aria-label={`Lihat ${counts.overdue} kamar menunggak, ${formatRupiah(overdueAmount)}`} onClick={onShowOverdue}>
                  {formatRupiah(overdueAmount)}
                  <span>{counts.overdue} kamar</span>
                </button>
              ) : (
                <span className="od-ok">Tidak ada</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Daftar tunggu</dt>
            <dd>
              <Link to="/owner/kos" className="od-link">
                {waitlistCount}
                <span>pengantre</span>
              </Link>
            </dd>
          </div>
        </dl>
      </div>

      <div className="od-building">
        <div className="od-building__head">
          <h2 className="od-eyebrow">Hunian</h2>
          <p className="od-building__value">
            {occupiedRooms} dari {totalRooms} <span>kamar terisi, {occupancyPct}%</span>
          </p>
        </div>
        <div className="od-map">
          {floors.map((floor) => (
            <div key={floor} className="od-map__floor">
              <span className="od-map__label">Lt. {floor}</span>
              <ul className="od-map__rooms">
                {rooms
                  .filter((r) => r.floor === floor)
                  .map((r) => (
                    <li key={r.id} className={`od-tile od-tile--${r.status}`} aria-label={`Kamar ${r.roomNumber}, ${STATUS_META[r.status].label}`}>
                      {r.roomNumber}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
        <ul className="od-legend" aria-hidden="true">
          {LEGEND_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <li key={s}>
              <span className={`od-swatch od-tile--${s}`} />
              {STATUS_META[s].label} {counts[s]}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
