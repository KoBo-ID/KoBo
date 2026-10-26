import React from 'react';
import { Link } from 'react-router-dom';
import type { BoardSummary } from '../../../../backend/src/trpc/router';
import type { RoomStatus } from '../../types';
import { formatRupiah } from '../../lib/ownerWorkspace';
import { STATUS_META } from './RoomOccupancyBoard';

const LEGEND_ORDER: RoomStatus[] = ['paid', 'due', 'overdue', 'booking', 'vacant'];

interface OwnerOverviewProps {
  summary: BoardSummary;
  /** Jump the room board to the rooms with this status. */
  onShowStatus: (status: RoomStatus) => void;
}

/**
 * The one panel on the dashboard: money this month beside the building. Only figures the board query returns.
 * Occupancy is a proportional bar, so it stays the same size for 1 room or 100. The status counts jump to the room board, which holds the per-room and per-floor detail.
 */
export const OwnerOverview: React.FC<OwnerOverviewProps> = ({ summary, onShowStatus }) => {
  const { collectedThisMonth, expectedThisMonth, overdueAmount, counts, totalRooms, occupiedRooms, waitlistCount } = summary;
  const collectedPct = expectedThisMonth > 0 ? Math.min(100, Math.round((collectedThisMonth / expectedThisMonth) * 100)) : 0;
  const occupancyPct = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;
  const segments = LEGEND_ORDER.filter((x) => counts[x] > 0);

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
                <button type="button" className="od-link od-link--late" aria-label={`Lihat ${counts.overdue} kamar menunggak, ${formatRupiah(overdueAmount)}`} onClick={() => onShowStatus('overdue')}>
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
        <div className="od-split" role="img" aria-label={`Status kamar: ${segments.map((x) => `${STATUS_META[x].label} ${counts[x]}`).join(', ')}`}>
          {segments.map((x) => (
            <span key={x} className={`od-split__seg od-split__seg--${x}`} style={{ flexGrow: counts[x] }} />
          ))}
        </div>
        <ul className="od-legend">
          {segments.map((x) => (
            <li key={x}>
              <button type="button" className="od-stat" aria-label={`${STATUS_META[x].label} ${counts[x]} kamar, tampilkan di Status Kamar`} onClick={() => onShowStatus(x)}>
                <span className={`od-swatch od-swatch--${x}`} aria-hidden="true" />
                {STATUS_META[x].label}
                <strong>{counts[x]}</strong>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
