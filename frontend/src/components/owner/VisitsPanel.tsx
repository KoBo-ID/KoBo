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
 * Survey visits with "Tandai Selesai" (owner.visit.complete). Works like "Perlu Perhatian": when a survey is
 * waiting (`promoted`) the dashboard puts this section above the room board and it lists only those visits;
 * otherwise it sits below the board with a quiet empty state and any completed visits as history.
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
    <section aria-labelledby="visits-title" style={promoted ? { marginBottom: '2rem' } : { marginTop: '2rem' }}>
      <h2 id="visits-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.75rem' }}>
        {promoted && (
          // Amber while surveys are waiting; red once any survey's day has passed without being marked done.
          <AlertTriangle size={18} aria-hidden="true" color={rows.some((v) => diffDays(v.date, today) > 0) ? 'var(--status-overdue)' : 'var(--status-due)'} />
        )}
        Jadwal Survey
      </h2>
      {visits.isError && <Notice tone="error">Gagal memuat jadwal survey.</Notice>}
      {complete.isError && <Notice tone="error">{messageForError(complete.error)}</Notice>}
      {!promoted && visits.isSuccess && (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: rows.length > 0 ? '0.75rem' : 0 }}>
          {all.some((v) => v.status !== 'CANCELLED')
            ? 'Tidak ada survey yang menunggu. Survey yang sudah selesai ada di bawah.'
            : 'Belum ada calon penghuni yang menjadwalkan survey.'}
        </p>
      )}
      {rows.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', backgroundColor: 'var(--bg-surface)' }}>
          {rows.map((v, i) => {
            // Same urgency language as "Telat N hari": a survey today is bold, one whose day passed without
            // being marked done is flagged in the overdue colour.
            const daysPast = v.status === 'SCHEDULED' ? diffDays(v.date, today) : 0;
            return (
              <li
                key={v.id}
                data-testid="owner-visit"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', padding: '0.8rem 1rem', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', fontSize: '0.875rem' }}
              >
                <span>
                  <strong>{v.student.name}</strong>
                  {v.student.campus ? ` · ${v.student.campus}` : ''}
                  {v.student.phone ? ` · ${v.student.phone}` : ''}
                  {' · '}
                  {formatVisitDate(v.date)}, {VISIT_SLOT_LABEL[v.timeSlot]}
                  {daysPast === 0 && v.status === 'SCHEDULED' ? <strong> (Hari ini)</strong> : null}
                  {daysPast > 0 ? <span style={{ color: 'var(--status-overdue)', fontWeight: 700 }}> (Terlewat {daysPast} hari)</span> : null}
                  {v.notes ? <span style={{ color: 'var(--text-muted)' }}> · "{v.notes}"</span> : null}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{STATUS_LABEL[v.status]}</span>
                  {v.status === 'SCHEDULED' && (
                    <Button variant="outline" size="sm" icon={<CheckCircle2 size={14} />} disabled={complete.isPending} onClick={() => complete.mutate({ kosId, visitId: v.id })}>
                      Tandai Selesai
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
