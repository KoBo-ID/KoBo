import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
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

  const [confirming, setConfirming] = useState<{ applicationId: string; decision: 'APPROVE' | 'REJECT'; name: string } | null>(null);
  const act = (applicationId: string, decision: 'APPROVE' | 'REJECT', applicantName: string) => setConfirming({ applicationId, decision, name: applicantName });

  const count = applications.data?.length ?? 0;
  // Nothing waiting: the dashboard shows one all-clear line instead of an empty section.
  if (applications.isSuccess && count === 0) return null;

  return (
    <section aria-labelledby="owner-applications-title" className="od-section">
      {confirming && (
        <ConfirmDialog
          title={confirming.decision === 'APPROVE' ? 'Terima pengajuan?' : 'Tolak pengajuan?'}
          message={confirming.decision === 'APPROVE' ? `Kamar akan ditahan 24 jam untuk pembayaran ${confirming.name}.` : `Pengajuan ${confirming.name} akan ditolak dan tidak menahan kamar.`}
          confirmLabel={confirming.decision === 'APPROVE' ? 'Terima Pengajuan' : 'Tolak Pengajuan'}
          danger={confirming.decision === 'REJECT'}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            decide.mutate({ kosId, applicationId: confirming.applicationId, decision: confirming.decision });
            setConfirming(null);
          }}
        />
      )}
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
