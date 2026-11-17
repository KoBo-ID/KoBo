import React from 'react';
import { CheckCircle2 } from 'lucide-react';
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
 * Survey visits with "Tandai selesai" (owner.visit.complete). Only scheduled visits stay active; completed and
 * cancelled ones move to a collapsed "Riwayat" (count only until expanded).
 */
export const VisitsPanel: React.FC<{ kosId: string }> = ({ kosId }) => {
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
  const rows = all.filter((v) => v.status === 'SCHEDULED');
  const history = all.filter((v) => v.status !== 'SCHEDULED');

  // Nothing scheduled and no history: no section at all (errors still show).
  if (rows.length === 0 && history.length === 0 && !visits.isError && !complete.isError) return null;

  return (
    <section aria-labelledby="visits-title" className="od-section">
      <h2 id="visits-title" className="od-section__title">
        Jadwal survey
        {rows.length > 0 && <span className="od-count">{rows.length}</span>}
      </h2>
      {visits.isError && <Notice tone="error">Gagal memuat jadwal survey.</Notice>}
      {complete.isError && <Notice tone="error">{messageForError(complete.error)}</Notice>}
      {rows.length === 0 && history.length > 0 && <p className="od-row__sub">Tidak ada survey terjadwal.</p>}
      {rows.length > 0 && (
        <ul className="od-list">
          {rows.map((v) => {
            // Same urgency language as "Telat N hari": a survey today is bold, one whose day passed without
            // being marked done is flagged in the overdue colour.
            const daysPast = diffDays(v.date, today);
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
                  {daysPast === 0 ? <span className="od-row__soon">Hari ini</span> : null}
                  {daysPast > 0 ? <span className="od-row__late">Terlewat {daysPast} hari</span> : null}
                </div>
                <div className="od-row__actions" style={{ alignItems: 'center' }}>
                  <Button variant="outline" size="sm" icon={<CheckCircle2 size={14} />} disabled={complete.isPending} onClick={() => complete.mutate({ kosId, visitId: v.id })}>
                    Tandai selesai
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {history.length > 0 && (
        <details className="od-history" data-testid="owner-visit-history">
          <summary>Riwayat survey ({history.length})</summary>
          <ul className="od-list">
            {history.map((v) => (
              <li key={v.id} className="od-row">
                <div className="od-row__main">
                  <span className="od-row__title">{v.student.name}</span>
                  <span className="od-row__sub">{[v.student.campus, v.student.phone].filter(Boolean).join(', ') || 'Calon penghuni'}</span>
                </div>
                <div className="od-row__due">
                  <span>{formatVisitDate(v.date)}, {VISIT_SLOT_LABEL[v.timeSlot]}</span>
                </div>
                <div className="od-row__actions">
                  <span className="od-row__sub">{STATUS_LABEL[v.status]}</span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};
