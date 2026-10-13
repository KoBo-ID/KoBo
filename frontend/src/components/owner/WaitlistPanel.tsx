import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Notice } from '../ui/Notice';
import { Button } from '../ui/Button';
import { useAppStore } from '../../store/AppContext';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { formatLongDate } from '../../utils/kosDetail';
import { roomTypeLabel, useOwnerWaitlist, WAITLIST_STATUS_LABEL } from '../../lib/waitlist';
import '../../styles/owner-kos.css';

const DOT = {
  WAITING: 'var(--status-booking)',
  OFFERED: 'var(--status-due)',
  FULFILLED: 'var(--status-paid)',
  EXPIRED: 'var(--status-vacant)',
  DECLINED: 'var(--status-vacant)',
  LEFT: 'var(--status-vacant)',
  REMOVED: 'var(--status-vacant)',
} as const;

/** One kos's daftar tunggu in the owner workspace: FIFO position, who, which type, and "Hapus". Owners cannot reorder. */
export const WaitlistPanel: React.FC<{ kosId: string; kosName: string }> = ({ kosId, kosName }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { addToast } = useAppStore();
  const list = useOwnerWaitlist(kosId);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const remove = useMutation(
    trpc.owner.waitlist.remove.mutationOptions({
      onSuccess: () => {
        setConfirmId(null);
        void qc.invalidateQueries({ queryKey: trpc.owner.waitlistEntries.queryKey({ kosId }) });
        void qc.invalidateQueries({ queryKey: trpc.owner.board.pathKey() });
        void qc.invalidateQueries({ queryKey: trpc.kos.pathKey() });
        addToast('Pengantre dihapus dari daftar tunggu.', 'success');
      },
    }),
  );
  const rows = list.data ?? [];
  const live = rows.filter((e) => e.status === 'WAITING' || e.status === 'OFFERED');

  return (
    <section className="owner-kos">
      <div className="owner-kos__section-head" style={{ marginBottom: '0.75rem' }}>
        <h3 className="owner-kos__section-title">
          Daftar tunggu <span>{live.length} pengantre</span>
        </h3>
      </div>
      {list.isError && <Notice tone="error">Gagal memuat daftar tunggu.</Notice>}
      {remove.isError && <Notice tone="error">{messageForError(remove.error)}</Notice>}
      {list.isSuccess && rows.length === 0 && (
        <p className="owner-kos__section-hint">
          Belum ada yang mengantre. Calon penghuni masuk ke daftar tunggu saat semua kamar terisi, dan Anda bisa melihat urutannya di sini.
        </p>
      )}
      {rows.length > 0 && (
        <div className="kobo-table-wrap">
          <table className="kobo-table">
            <caption className="owner-kos__sr">Daftar tunggu {kosName}</caption>
            <thead>
              <tr>
                <th scope="col">Antrean</th>
                <th scope="col">Pengantre</th>
                <th scope="col">Tipe</th>
                <th scope="col">Bergabung</th>
                <th scope="col">Status</th>
                <th scope="col" className="kobo-table__right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const isLive = e.status === 'WAITING' || e.status === 'OFFERED';
                return (
                  <tr key={e.id} data-testid="owner-waitlist-row">
                    <td className="kobo-table__strong kobo-table__num">{e.position !== null ? `#${e.position}` : '-'}</td>
                    <td>
                      <span className="kobo-table__strong">{e.user.name}</span>
                      {e.user.campus ? <span className="kobo-table__muted">, {e.user.campus}</span> : null}
                      {e.user.campusVerified && (
                        <span title="Email kampus terverifikasi" style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: '0.3rem', color: 'var(--primary)' }}>
                          <ShieldCheck size={14} aria-label="Email kampus terverifikasi" />
                        </span>
                      )}
                    </td>
                    <td>{roomTypeLabel(e.roomType)}</td>
                    <td className="kobo-table__muted">{formatLongDate(e.createdAt)}</td>
                    <td>
                      <span className="kobo-status" style={{ ['--dot' as string]: DOT[e.status] }}>
                        <span className="kobo-status__dot" aria-hidden="true" />
                        {WAITLIST_STATUS_LABEL[e.status]}
                        {e.offer ? `, Kamar ${e.offer.roomNumber}` : ''}
                      </span>
                    </td>
                    <td>
                      <div className="kobo-table__actions" style={{ opacity: 1 }}>
                        {isLive && confirmId === e.id ? (
                          <>
                            <Button variant="outline" size="sm" style={{ minHeight: 40 }} onClick={() => setConfirmId(null)}>
                              Batal
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              style={{ minHeight: 40 }}
                              aria-label={`Hapus ${e.user.name} dari daftar tunggu`}
                              isLoading={remove.isPending}
                              onClick={() => remove.mutate({ kosId, entryId: e.id })}
                            >
                              Hapus
                            </Button>
                          </>
                        ) : (
                          isLive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              style={{ minHeight: 40, color: 'var(--status-overdue)' }}
                              aria-label={`Hapus ${e.user.name} dari daftar tunggu`}
                              onClick={() => setConfirmId(e.id)}
                            >
                              Hapus
                            </Button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
