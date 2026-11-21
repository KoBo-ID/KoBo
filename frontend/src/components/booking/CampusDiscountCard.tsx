import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, CheckCircle2 } from 'lucide-react';
import { DISCOUNT_LABEL } from '@kobo/shared/domain';
import { Button } from '../ui/Button';
import { Popover } from '../ui/Popover';
import { useAppStore } from '../../store/AppContext';
import { useSession } from '../../lib/session';
import { useTRPC } from '../../lib/trpc';
import { formatRupiah } from '../../lib/format';

/** The active "Kampus Mitra" list (public, cached). */
export function usePartnerCampuses() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.campus.affiliations.queryOptions(), staleTime: 5 * 60_000 });
}

/** Whether the signed-in student's verified campus is a partner campus. Idle when signed out. */
export function useMyDiscountStatus() {
  const trpc = useTRPC();
  const { me } = useSession();
  return useQuery({ ...trpc.campus.myDiscountStatus.queryOptions(), enabled: !!me });
}

/** "A, B, C" from the partner list; '' while loading, on error or when empty. */
export function partnerLabelList(list: { label: string }[] | undefined): string {
  return (list ?? []).map((c) => c.label).join(', ');
}

/** "Lihat kampus mitra": a popover listing the partner campuses, with its own loading, error and empty states. */
export const PartnerCampusLink: React.FC = () => {
  const partners = usePartnerCampuses();
  return (
    <Popover
      align="left"
      label="Kampus mitra KoBo"
      trigger={(props) => (
        <button type="button" {...props} style={{ background: 'none', border: 0, padding: 0, color: 'var(--primary)', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
          Lihat kampus mitra
        </button>
      )}
    >
      {() => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: 'var(--step--1)', minWidth: '14rem' }}>
          <strong>Kampus mitra KoBo</strong>
          {partners.isPending ? (
            <span role="status" style={{ color: 'var(--text-muted)' }}>Memuat daftar kampus…</span>
          ) : partners.isError ? (
            <span role="alert" style={{ color: 'var(--text-muted)' }}>
              Gagal memuat daftar. <button type="button" onClick={() => void partners.refetch()} style={{ background: 'none', border: 0, padding: 0, color: 'var(--primary)', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Coba lagi</button>
            </span>
          ) : partners.data.length === 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>Belum ada kampus mitra saat ini.</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--text-main)' }}>
              {partners.data.map((c) => <li key={c.campusId}>{c.label}</li>)}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
};

interface CampusDiscountCardProps {
  /** The kos's own first-payment discount, when it offers one. Never a made-up figure. */
  studentDiscountAmount?: number;
}
/**
 * Diskon Kampus Mitra status on checkout. Verification itself (campus email code or link, campus account, KTM) lives in
 * StudentVerificationCard on /profile; this card only shows the state and links there.
 */
export const CampusDiscountCard: React.FC<CampusDiscountCardProps> = ({ studentDiscountAmount }) => {
  const { me } = useSession();
  const { openAuthModal } = useAppStore();
  const status = useMyDiscountStatus();
  const verified = !!status.data?.verified;
  const affiliated = !!status.data?.affiliated;
  const active = verified && affiliated;
  const amount = studentDiscountAmount ? formatRupiah(studentDiscountAmount) : null;

  let text: React.ReactNode;
  if (!me) text = amount ? `Masuk dan verifikasi status mahasiswa untuk ${DISCOUNT_LABEL} ${amount} di pembayaran pertama.` : `${DISCOUNT_LABEL} berlaku untuk mahasiswa kampus mitra KoBo.`;
  else if (status.isPending) text = 'Memeriksa status kampus Anda…';
  else if (status.isError) text = <>Gagal memeriksa status kampus. <button type="button" onClick={() => void status.refetch()} style={{ background: 'none', border: 0, padding: 0, color: 'var(--primary)', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Coba lagi</button></>;
  else if (active) text = <>{amount ? `Potongan ${amount} untuk pembayaran pertama.` : 'Berlaku untuk pembayaran pertama pada kos yang menyediakannya.'} Diskon dikonfirmasi saat pemilik menyetujui.</>;
  else if (verified) text = <>{DISCOUNT_LABEL} tidak berlaku untuk {status.data?.campusName ?? 'kampus Anda'}. <PartnerCampusLink /></>;
  else text = amount ? `Verifikasi status mahasiswa untuk ${DISCOUNT_LABEL} ${amount} di pembayaran pertama (kampus mitra).` : `Verifikasi status mahasiswa untuk ${DISCOUNT_LABEL} dari pemilik.`;

  return (
    <div
      style={{
        backgroundColor: active ? 'var(--primary-light)' : 'var(--bg-page)',
        border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '1.1rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: active ? 'var(--primary)' : 'var(--bg-muted)', color: active ? 'white' : 'var(--text-muted)' }}>
          <GraduationCap size={22} aria-hidden="true" />
        </div>
        <div style={{ minWidth: 0 }}>
          <h4 style={{ fontSize: 'var(--step-0)', fontWeight: 700, color: 'var(--text-main)' }}>{DISCOUNT_LABEL}</h4>
          <div style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{text}</div>
        </div>
      </div>
      {active ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--primary)', fontSize: 'var(--step--1)', fontWeight: 700, flexShrink: 0 }}>
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>Aktif</span>
        </div>
      ) : me ? (
        !verified && !status.isPending && !status.isError && !me.user.isDemo && (
          <Link to="/profile">
            <Button size="sm" variant="primary">Verifikasi</Button>
          </Link>
        )
      ) : (
        <Button size="sm" variant="primary" onClick={openAuthModal}>Masuk</Button>
      )}
    </div>
  );
};
