import React from 'react';
import { Link } from 'react-router-dom';
import type { PartnerRequestStatusName, PartnerRequestView } from '@kobo/shared/types';
import { Button } from '../ui/Button';
import { ScoreBadge } from './ScoreBreakdown';
import { AGE_BAND_LABEL, MATCH_BASE, formatChatTime } from '../../lib/matching';
import '../../styles/matching.css';
import '../../styles/matching-chat.css';

const STATUS_LABEL = (status: PartnerRequestStatusName, direction: 'sent' | 'received'): string => {
  switch (status) {
    case 'PENDING': return 'Menunggu jawaban';
    case 'ACCEPTED': return 'Diterima';
    case 'DECLINED': return direction === 'sent' ? 'Tidak dilanjutkan' : 'Kamu tolak';
    case 'CANCELLED': return 'Dibatalkan';
    default: return 'Kedaluwarsa';
  }
};

/**
 * One request in Permintaan. Props: `request` (PartnerRequestView); `busy` disables the buttons while any mutation runs;
 * `onAccept` / `onDecline` (received, PENDING) and `onCancel` (sent, PENDING) get the request id.
 * A received request whose `blockedByCap` is set shows "Akhiri satu koneksi dulu" with a link to Pesan and no Terima button.
 */
export const RequestRow: React.FC<{
  request: PartnerRequestView;
  busy: boolean;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onCancel: (id: string) => void;
}> = ({ request: r, busy, onAccept, onDecline, onCancel }) => {
  const pending = r.status === 'PENDING';
  const name = r.partner.profileId && !r.partner.deleted
    ? <Link to={`${MATCH_BASE}/p/${r.partner.profileId}`} className="mc-link">{r.partner.displayName}</Link>
    : <span>{r.partner.displayName}</span>;
  return (
    <li className="mt-card mc-req" data-status={r.status}>
      <div className="mt-card__top">
        <div style={{ minWidth: 0 }}>
          <div className="mt-card__name">{name}</div>
          <div className="mt-card__sub">
            {r.partner.ageBand ? `${AGE_BAND_LABEL(r.partner.ageBand)} · ` : ''}
            {r.direction === 'received' ? 'Diterima' : 'Dikirim'} {formatChatTime(r.createdAt)}
          </div>
        </div>
        {r.match && <ScoreBadge match={r.match} />}
      </div>
      {r.message && <p className="mc-quote">{r.message}</p>}
      <div className="mt-row">
        <span className="mc-tag" data-tone={pending ? 'wait' : r.status === 'ACCEPTED' ? 'ok' : 'off'}>{STATUS_LABEL(r.status, r.direction)}</span>
        {pending && <span className="mt-help">Kedaluwarsa {formatChatTime(r.expiresAt)}</span>}
      </div>
      {pending && r.direction === 'received' && r.blockedByCap && (
        <p className="mt-help" role="note">
          Kamu sudah mencapai batas koneksi. Akhiri satu koneksi dulu di <Link to={`${MATCH_BASE}/pesan`} className="mc-link">Pesan</Link>, lalu terima permintaan ini.
        </p>
      )}
      {pending && (
        <div className="mt-row">
          {r.direction === 'received' ? (
            <>
              <Button size="sm" variant="primary" disabled={busy || r.blockedByCap} onClick={() => onAccept(r.id)}>Terima</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecline(r.id)}>Tolak</Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onCancel(r.id)}>Batalkan</Button>
          )}
        </div>
      )}
      {r.status === 'ACCEPTED' && <div><Link to={`${MATCH_BASE}/pesan`} className="mc-link">Buka Pesan</Link></div>}
    </li>
  );
};
