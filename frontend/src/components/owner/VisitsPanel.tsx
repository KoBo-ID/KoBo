import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { diffDays, todayWIB } from '@kobo/shared/domain';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { useAppStore } from '../../store/AppContext';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { formatVisitDate, useOwnerVisits, VISIT_SLOT_LABEL } from '../../lib/visits';

const STATUS_LABEL = { SCHEDULED: 'Terjadwal', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan' } as const;

/**
 * Survey visits with "Tandai selesai" (owner.visit.complete). Sits in a fixed place on the dashboard. When a survey is
 * waiting (`promoted`) it lists only those visits; otherwise it shows a quiet empty state and any completed visits as history.
 */
export const VisitsPanel: React.FC<{ kosId: string; promoted: boolean }> = ({ kosId, promoted }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { addToast } = useAppStore();
  const visits = useOwnerVisits(kosId);
  const complete = useMutation(
    trpc.owner.visit.complete.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.owner.visits.queryKey({ kosId }) });
        addToast('Survey ditandai selesai.', 'success');
      },
    }),
  );

  const today = todayWIB(new Date());
  const all = visits.data ?? [];
  const rows = promoted ? all.filter((v) => v.status === 'SCHEDULED') : all.filter((v) => v.status === 'COMPLETED');

  return (
    <section aria-labelledby="visits-title" className="od-section">
      <h2 id="visits-title" className="od-section__title">
        {promoted && (
          // Amber while surveys are waiting; red once any survey's day has passed without being marked done.
          <AlertTriangle size={18} aria-hidden="true" color={rows.some((v) => diffDays(v.date, today) > 0) ? 'var(--status-overdue)' : 'var(--status-due)'} />
        )}
        Jadwal survey
        {promoted && rows.length > 0 && <span className="od-count">{rows.length}</span>}
      </h2>
      {visits.isError && <Notice tone="error">Gagal memuat jadwal survey.</Notice>}
      {complete.isError && <Notice tone="error">{messageForError(complete.error)}</Notice>}
      {!promoted && visits.isSuccess && (
        <p className="od-empty" style={{ marginBottom: rows.length > 0 ? '0.75rem' : 0 }}>
          {all.some((v) => v.status !== 'CANCELLED')
            ? 'Tidak ada survey yang menunggu. Survey yang sudah selesai ada di bawah.'
            : 'Belum ada survey. Calon penghuni yang menjadwalkan kunjungan akan muncul di sini, lengkap dengan tombol untuk menandainya selesai.'}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="od-list">
          {rows.map((v) => {
            // Same urgency language as "Telat N hari": a survey today is bold, one whose day passed without
            // being marked done is flagged in the overdue colour.
            const daysPast = v.status === 'SCHEDULED' ? diffDays(v.date, today) : 0;
            return (
              <li key={v.id} data-testid="owner-visit" className="od-row">
                <div className="od-row__main">
                  <span className="od-row__title">{v.student.name}</span>
                  <span className="od-row__sub">
                    {[v.student.campus, v.student.phone].filter(Boolean).join(', ') || 'Calon penghuni'}
                  </span>
                  {v.notes ? <span className="od-row__note">"{v.notes}"</span> : null}
                </div>
                <div className="od-row__due">
                  <span>{formatVisitDate(v.date)}, {VISIT_SLOT_LABEL[v.timeSlot]}</span>
                  {daysPast === 0 && v.status === 'SCHEDULED' ? <span className="od-row__soon">Hari ini</span> : null}
                  {daysPast > 0 ? <span className="od-row__late">Terlewat {daysPast} hari</span> : null}
                </div>
                <div className="od-row__actions" style={{ alignItems: 'center' }}>
                  {v.status !== 'SCHEDULED' && <span className="od-row__sub">{STATUS_LABEL[v.status]}</span>}
                  {v.status === 'SCHEDULED' && (
                    <Button variant="outline" size="sm" icon={<CheckCircle2 size={14} />} disabled={complete.isPending} onClick={() => complete.mutate({ kosId, visitId: v.id })}>
                      Tandai selesai
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
