import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib/trpc';

const KIND: Record<string, string> = {
  REMINDER_H7: 'Pengingat 7 hari',
  REMINDER_H3: 'Pengingat 3 hari',
  REMINDER_H1: 'Pengingat 1 hari',
  EMERGENCY_CONTACT: 'Kontak darurat',
};
const CHANNEL: Record<string, string> = { EMAIL: 'Email', WHATSAPP: 'WhatsApp' };
const when = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

/** What KoBo sent the students about unpaid invoices in this kos (collapsed; count only until opened). */
export const RemindersLog: React.FC<{ kosId: string }> = ({ kosId }) => {
  const trpc = useTRPC();
  const q = useQuery(trpc.owner.tenant.notifications.queryOptions({ kosId }));
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="reminders-title" className="od-section">
      <h2 id="reminders-title" className="od-section__title">
        Pengingat yang dikirim <span className="od-count">{rows.length}</span>
      </h2>
      <details className="od-history" data-testid="reminders-log">
        <summary>Lihat riwayat pengingat</summary>
        <ul className="od-list">
          {rows.map((r) => (
            <li key={r.id} className="od-row">
              <div className="od-row__main">
                <span className="od-row__title">Kamar {r.roomNumber}, {r.tenantName}</span>
                <span className="od-row__sub">{KIND[r.kind] ?? r.kind} lewat {CHANNEL[r.channel] ?? r.channel}{r.recipient === 'KONTAK_DARURAT' ? ' ke kontak darurat' : ''}</span>
              </div>
              <div className="od-row__due"><span>{when(r.at)}</span></div>
              <div className="od-row__actions"><span className={r.status === 'SENT' ? 'od-row__sub' : 'od-row__late'}>{r.status === 'SENT' ? 'Terkirim' : 'Gagal'}</span></div>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
};
