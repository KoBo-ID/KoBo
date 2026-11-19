import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Notice } from '../ui/Notice';
import { Skeleton } from '../ui/Skeleton';
import { TenantProfileModal } from './TenantProfileModal';
import { messageForError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useAppStore } from '../../store/AppContext';

const formatDate = (date: string) =>
  new Date(`${date}T00:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });

// SHEERID (dev/test only) is never named to owners: SheerID's VSA §3.2(e) bars passing its Result to third parties.
const VIA_LABEL = { EMAIL: 'email kampus', MICROSOFT: 'akun Microsoft kampus', GOOGLE: 'akun Google kampus', KTM: 'KTM', SHEERID: 'verifikasi kampus' } as const;
/** Program and semester for new applications; old rows only have the free-text occupation. */
const detail = (a: { program: string | null; semester: number | null; occupation: string | null }) => {
  const parts = [a.program, a.semester ? `Semester ${a.semester}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : (a.occupation ?? '');
};

export const ApplicationsPanel: React.FC<{ kosId: string }> = ({ kosId }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { addToast } = useAppStore();
  const applications = useQuery(trpc.application.ownerList.queryOptions({ kosId }));
  const decide = useMutation(trpc.application.decide.mutationOptions({
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trpc.application.ownerList.queryKey({ kosId }) });
      void qc.invalidateQueries({ queryKey: trpc.owner.board.queryKey({ kosId }) });
      void qc.invalidateQueries({ queryKey: trpc.owner.myKos.queryKey() });
      void qc.invalidateQueries({ queryKey: trpc.kos.detail.queryKey() });
    },
  }));

  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ applicationId: string; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const act = (applicationId: string, decision: 'APPROVE' | 'REJECT') => setConfirming({ applicationId, decision });

  const count = applications.data?.length ?? 0;
  const target = confirming ? applications.data?.find((a) => a.id === confirming.applicationId) : undefined;
  const othersForRoom = target ? (applications.data ?? []).filter((a) => a.id !== target.id && a.room.id === target.room.id).length : 0;

  // Focus goes back to the button that opened the dialog; if that row is gone (decided), to the section, then to <main>.
  const returnFocus = (key: string, decided: boolean) => {
    setTimeout(() => {
      const trigger = decided ? null : document.querySelector<HTMLElement>(`[data-app-action="${key}"]`);
      const fallback = document.getElementById('owner-applications-title') ?? document.getElementById('main');
      const el = trigger ?? fallback;
      if (el && !el.hasAttribute('tabindex') && !(el instanceof HTMLButtonElement)) el.setAttribute('tabindex', '-1');
      el?.focus();
    }, 0);
  };
  const closeConfirm = () => {
    if (confirming) returnFocus(`${confirming.applicationId}:${confirming.decision}`, false);
    setConfirming(null);
  };
  // Nothing waiting: the dashboard shows one all-clear line instead of an empty section.
  if (applications.isSuccess && count === 0) return null;

  return (
    <section aria-labelledby="owner-applications-title" className="od-section">
      {confirming && target && (
        <ConfirmDialog
          title={confirming.decision === 'APPROVE' ? 'Terima pengajuan?' : 'Tolak pengajuan?'}
          message={
            <>
              <strong>{target.applicant.name}</strong>, Kamar {target.room.roomNumber} ({target.room.type}), mulai {formatDate(target.startDate)} selama {target.durationMonths} bulan.
              <br />
              {confirming.decision === 'APPROVE'
                ? `Kamar akan ditahan 24 jam untuk pembayaran ${target.applicant.name}.`
                : `Pengajuan ini akan ditolak dan tidak menahan kamar.`}
              {confirming.decision === 'APPROVE' && othersForRoom > 0 && (
                <>
                  <br />
                  <strong>
                    {othersForRoom} pengajuan lain untuk kamar ini akan otomatis ditolak.
                  </strong>
                </>
              )}
            </>
          }
          confirmLabel={confirming.decision === 'APPROVE' ? 'Terima Pengajuan' : 'Tolak Pengajuan'}
          danger={confirming.decision === 'REJECT'}
          onCancel={closeConfirm}
          onConfirm={() => {
            const { applicationId, decision } = confirming;
            const name = target.applicant.name;
            decide.mutate(
              { kosId, applicationId, decision },
              {
                onSuccess: () => addToast(decision === 'APPROVE' ? `Pengajuan ${name} diterima. Kamar ditahan 24 jam.` : `Pengajuan ${name} ditolak.`, 'success'),
                onError: (err) => addToast(messageForError(err), 'error'),
              },
            );
            setConfirming(null);
            returnFocus(`${applicationId}:${decision}`, true);
          }}
        />
      )}
      {profileFor && <TenantProfileModal target={{ kosId, applicationId: profileFor }} onClose={() => setProfileFor(null)} />}
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
      {applications.isSuccess && count > 0 && (
        <ul className="od-list">
          {applications.data.map((application) => (
            <li key={application.id} data-testid="owner-application" className="od-row">
              {/* The name is the profile link; meta and request details read as one line each. */}
              <div className="od-row__main">
                <button type="button" className="od-person" aria-label={`Lihat profil ${application.applicant.name}`} onClick={() => setProfileFor(application.id)}>
                  {application.applicant.name}
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
                <span className="od-row__sub">
                  Kamar {application.room.roomNumber} · {application.room.type}
                  {application.applicant.campus ? ` · ${application.applicant.campus}` : ''}
                </span>
              </div>
              <div className="od-row__main">
                <span>Mulai {formatDate(application.startDate)} · {application.durationMonths} bulan</span>
                <span className="od-row__sub">
                  {application.student.verified
                    ? `Mahasiswa terverifikasi · ${application.student.campus ?? '-'}${application.student.via ? ` · ${VIA_LABEL[application.student.via]}` : ''}`
                    : 'Belum terverifikasi'}
                </span>
                <span className="od-row__sub od-row__oneline" title={[detail(application), application.note].filter(Boolean).join(' · ')}>
                  {detail(application)}
                  {application.note ? `${detail(application) ? ' · ' : ''}"${application.note}"` : ''}
                </span>
              </div>
              <div className="od-row__actions">
                <Button variant="outline" size="sm" icon={<X size={14} />} disabled={decide.isPending} data-app-action={`${application.id}:REJECT`} onClick={() => act(application.id, 'REJECT')}>Tolak</Button>
                <Button variant="primary" size="sm" icon={<Check size={14} />} disabled={decide.isPending} data-app-action={`${application.id}:APPROVE`} onClick={() => act(application.id, 'APPROVE')}>Terima</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
