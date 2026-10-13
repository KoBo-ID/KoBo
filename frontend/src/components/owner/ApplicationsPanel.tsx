import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { Skeleton } from '../ui/Skeleton';
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

  const act = (applicationId: string, decision: 'APPROVE' | 'REJECT', applicantName: string) => {
    const prompt = decision === 'APPROVE'
      ? `Terima pengajuan ${applicantName}? Kamar akan ditahan 24 jam untuk pembayaran.`
      : `Tolak pengajuan ${applicantName}?`;
    if (window.confirm(prompt)) decide.mutate({ kosId, applicationId, decision });
  };

  const count = applications.data?.length ?? 0;

  return (
    <section aria-labelledby="owner-applications-title" className="od-section">
      <h2 id="owner-applications-title" className="od-section__title">
        Pengajuan sewa
        {count > 0 && <span className="od-count">{count}</span>}
      </h2>
      {applications.isPending && (
        <div className="od-skel-list" role="status" aria-label="Memuat pengajuan sewa">
          {[0, 1].map((i) => (
            <div key={i} className="od-skel-row">
              <Skeleton width="70%" height="1rem" />
              <Skeleton width="50%" height="1rem" />
              <Skeleton width="60%" height="1rem" />
            </div>
          ))}
        </div>
      )}
      {applications.isError && <Notice tone="error">Gagal memuat pengajuan sewa.</Notice>}
      {decide.isError && <div style={{ marginBottom: '0.75rem' }}><Notice tone="error">{messageForError(decide.error)}</Notice></div>}
      {applications.isSuccess && count === 0 && (
        <p className="od-empty">Belum ada pengajuan. Saat calon penghuni mengajukan sewa, Anda bisa menerima atau menolaknya di sini.</p>
      )}
      {applications.isSuccess && count > 0 && (
        <ul className="od-list">
          {applications.data.map((application) => (
            <li key={application.id} data-testid="owner-application" className="od-row">
              <div className="od-row__main">
                <span className="od-row__title">{application.applicant.name}</span>
                <span className="od-row__sub">
                  Kamar {application.room.roomNumber}, {application.room.type}
                  {application.applicant.campus ? `, ${application.applicant.campus}` : ''}
                </span>
              </div>
              <div className="od-row__due">
                <span>Mulai {formatDate(application.startDate)}</span>
                <span className="od-row__sub">{application.durationMonths} bulan, {application.occupation}</span>
                {application.note && <span className="od-row__note">{application.note}</span>}
              </div>
              <div className="od-row__actions">
                <Button variant="outline" size="sm" icon={<X size={14} />} disabled={decide.isPending} onClick={() => act(application.id, 'REJECT', application.applicant.name)}>Tolak</Button>
                <Button variant="primary" size="sm" icon={<Check size={14} />} disabled={decide.isPending} onClick={() => act(application.id, 'APPROVE', application.applicant.name)}>Terima</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
