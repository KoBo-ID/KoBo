import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Phone, ShieldAlert, Star } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Notice } from '../ui/Notice';
import { Skeleton } from '../ui/Skeleton';
import { messageForError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';

type Target = { kosId: string; applicationId: string; tenancyId?: undefined } | { kosId: string; tenancyId: string; applicationId?: undefined };

const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '9rem minmax(0, 1fr)', columnGap: '1rem', alignItems: 'baseline', fontSize: '0.875rem' };
const label: React.CSSProperties = { color: 'var(--text-muted)' };

/** "Profil penyewa": what the student has shared with this owner. Opening it is logged; phone and emergency contact appear once accepted. */
export const TenantProfileModal: React.FC<{ target: Target; onClose: () => void }> = ({ target, onClose }) => {
  const trpc = useTRPC();
  const q = useQuery({ ...trpc.owner.tenant.tenantProfile.queryOptions(target), staleTime: 0, gcTime: 0, retry: false });
  const p = q.data;

  return (
    <Modal isOpen onClose={onClose} title="Profil penyewa" subtitle={p?.accepted === false ? 'Data lain terbuka setelah pengajuan disetujui.' : undefined} maxWidth="sm">
      {q.isPending && <Skeleton width="100%" height="9rem" />}
      {q.isError && <Notice tone="error">{messageForError(q.error)}</Notice>}
      {p && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }} data-testid="tenant-profile">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <strong style={{ fontSize: '1.125rem' }}>{p.name}</strong>
            {p.campusVerified && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: 700 }}>
                <BadgeCheck size={14} aria-hidden="true" /> Email kampus terverifikasi
              </span>
            )}
          </div>
          <div style={row}><span style={label}>Kampus</span><span>{p.campus ?? 'Belum diisi'}</span></div>
          <div style={row}>
            <span style={label}>WhatsApp</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              {p.phone ? (<><Phone size={14} aria-hidden="true" />{p.phone}</>) : <span style={label}>Terbuka setelah disetujui</span>}
            </span>
          </div>
          <div style={row}>
            <span style={label}>Kontak darurat</span>
            {p.emergencyContact ? (
              <span>{p.emergencyContact.name} ({p.emergencyContact.relation}), {p.emergencyContact.phone}</span>
            ) : (
              <span style={label}>{p.accepted ? 'Belum diisi atau tidak diizinkan' : 'Terbuka setelah disetujui'}</span>
            )}
          </div>
          <div style={row}>
            <span style={label}>Ulasan ditulis</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              {p.reviews.count === 0 ? 'Belum ada' : (<>{p.reviews.count} ulasan, rata-rata <Star size={13} aria-hidden="true" /> {p.reviews.averageGiven}</>)}
            </span>
          </div>
          <div style={row}>
            <span style={label}>Ketepatan bayar</span>
            <span>
              {p.payments.onTime + p.payments.late + p.payments.overdue === 0
                ? 'Belum ada riwayat tagihan'
                : `${p.payments.onTime} tepat waktu, ${p.payments.late} terlambat${p.payments.overdue ? `, ${p.payments.overdue} menunggak` : ''}`}
            </span>
          </div>
          <p style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start', margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: '0.1rem' }} aria-hidden="true" />
            Data ini hanya untuk menilai dan mengelola sewa di kos Anda. Setiap pembukaan profil tercatat.
          </p>
        </div>
      )}
    </Modal>
  );
};
