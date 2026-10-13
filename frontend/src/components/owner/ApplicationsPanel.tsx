import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { messageForError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';

const formatDate = (date: string) =>
  new Date(`${date}T00:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });

export const ApplicationsPanel: React.FC<{ kosId: string }> = ({ kosId }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const applications = useQuery(trpc.application.ownerList.queryOptions({ kosId }));
  const decide = useMutation(trpc.application.decide.mutationOptions({
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trpc.application.ownerList.queryKey({ kosId }) });
      void qc.invalidateQueries({ queryKey: trpc.owner.board.queryKey({ kosId }) });
      void qc.invalidateQueries({ queryKey: trpc.owner.myKos.queryKey() });
      void qc.invalidateQueries({ queryKey: trpc.kos.detail.queryKey() });
    },
  }));

  if (applications.isPending) return <p role="status" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Memuat pengajuan sewa…</p>;
  if (applications.isError) return <div style={{ marginBottom: '1.5rem' }}><Notice tone="error">Gagal memuat pengajuan sewa.</Notice></div>;
  if (applications.data.length === 0) return null;

  const act = (applicationId: string, decision: 'APPROVE' | 'REJECT', applicantName: string) => {
    const prompt = decision === 'APPROVE'
      ? `Terima pengajuan ${applicantName}? Kamar akan ditahan 24 jam untuk pembayaran.`
      : `Tolak pengajuan ${applicantName}?`;
    if (window.confirm(prompt)) decide.mutate({ kosId, applicationId, decision });
  };

  return (
    <section aria-labelledby="owner-applications-title" style={{ marginBottom: '2rem' }}>
      <h2 id="owner-applications-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.75rem' }}>
        <ClipboardList size={18} color="var(--status-due)" /> Pengajuan Sewa ({applications.data.length})
      </h2>
      {decide.isError && <div style={{ marginBottom: '0.75rem' }}><Notice tone="error">{messageForError(decide.error)}</Notice></div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', backgroundColor: 'var(--bg-surface)' }}>
        {applications.data.map((application, index) => (
          <li key={application.id} data-testid="owner-application" style={{ padding: '1rem', borderTop: index ? '1px solid var(--border-subtle)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', flexWrap: 'wrap' }}>
                <strong>{application.applicant.name}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Kamar {application.room.roomNumber} · {application.room.type}</span>
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Mulai {formatDate(application.startDate)} · {application.durationMonths} bulan · {application.occupation}</p>
              {application.applicant.campus && <p style={{ fontSize: '0.76rem', color: 'var(--text-subtle)', marginTop: '0.15rem' }}>Kampus: {application.applicant.campus}</p>}
              {application.note && <p style={{ fontSize: '0.82rem', color: 'var(--text-main)', marginTop: '0.4rem', maxWidth: '620px' }}>{application.note}</p>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Button variant="outline" size="sm" icon={<X size={14} />} disabled={decide.isPending} onClick={() => act(application.id, 'REJECT', application.applicant.name)}>Tolak</Button>
              <Button variant="primary" size="sm" icon={<Check size={14} />} disabled={decide.isPending} onClick={() => act(application.id, 'APPROVE', application.applicant.name)}>Terima</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
