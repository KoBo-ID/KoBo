import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { useAppStore } from '../../store/AppContext';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { formatVisitDate, VISIT_SLOT_LABEL } from '../../lib/visits';

const STATUS_LABEL = { SCHEDULED: 'Terjadwal', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan' } as const;

/** Free survey visits booked for one kos (owner.visits), with "Tandai Selesai" (owner.visit.complete). */
export const VisitsPanel: React.FC<{ kosId: string }> = ({ kosId }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { addToast } = useAppStore();
  const visits = useQuery(trpc.owner.visits.queryOptions({ kosId }));
  const complete = useMutation(
    trpc.owner.visit.complete.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.owner.visits.queryKey({ kosId }) });
        addToast('Survey ditandai selesai.', 'success');
      },
    }),
  );
  const rows = (visits.data ?? []).filter((v) => v.status !== 'CANCELLED');

  return (
    <section aria-labelledby="visits-title" style={{ marginTop: '2rem' }}>
      <h2 id="visits-title" style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.75rem' }}>
        Jadwal Survey
      </h2>
      {visits.isError && <Notice tone="error">Gagal memuat jadwal survey.</Notice>}
      {complete.isError && <Notice tone="error">{messageForError(complete.error)}</Notice>}
      {visits.isSuccess && rows.length === 0 && (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Belum ada calon penghuni yang menjadwalkan survey.</p>
      )}
      {rows.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', backgroundColor: 'var(--bg-surface)' }}>
          {rows.map((v, i) => (
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
          ))}
        </ul>
      )}
    </section>
  );
};
