import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, ShieldCheck, FileText } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ErrorState, NotFoundState } from '../components/ui/QueryState';
import { useSession } from '../lib/session';
import { useTRPC } from '../lib/trpc';
import { errorCode } from '../lib/queryErrors';
import { messageForError } from '../lib/errors';
import { useAppStore } from '../store/AppContext';

const formatRupiah = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

const longDate = (d: Date) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

const METHOD_LABEL = {
  MOCK: 'Pembayaran online KoBo (simulasi)',
  MANUAL: 'Dicatat manual oleh pemilik (tunai / transfer)',
} as const;

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '0.5rem' }}>
    <span style={{ color: '#64748B', fontWeight: 600 }}>{label}</span>
    <span>{children}</span>
  </div>
);

/** /kuitansi/:receiptNo. The tenant who paid or the kos owner; "Unduh PDF" is the browser's print dialog. */
export const Kuitansi: React.FC = () => {
  const { receiptNo: param } = useParams();
  const trpc = useTRPC();
  const { me, isLoading } = useSession();
  const { openAuthModal } = useAppStore();
  const number = param && /^\d{1,10}$/.test(param) ? Number(param) : null;
  const q = useQuery({ ...trpc.kuitansi.get.queryOptions({ receiptNo: number ?? 0 }), enabled: !!me && number !== null });

  if (number === null) {
    return <NotFoundState title="Kuitansi tidak ditemukan" text="Nomor kuitansi tidak valid." linkTo="/my-kos" linkLabel="Ke Kos Saya" />;
  }
  if (isLoading) return <p role="status" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Memuat…</p>;
  if (!me) {
    return (
      <div className="app-container" style={{ paddingTop: '4rem', textAlign: 'center', minHeight: '50vh' }}>
        <FileText size={40} color="var(--text-subtle)" style={{ margin: '0 auto 1rem' }} />
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Masuk untuk Melihat Kuitansi</h1>
        <p style={{ color: 'var(--text-muted)', margin: '0.5rem auto 1.25rem', maxWidth: '380px' }}>Kuitansi hanya dapat dibuka oleh penyewa yang membayar dan pemilik kosnya.</p>
        <Button variant="primary" size="md" onClick={openAuthModal}>Masuk</Button>
      </div>
    );
  }
  if (q.isPending) return <p role="status" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Memuat kuitansi…</p>;
  if (q.isError) {
    const code = errorCode(q.error);
    if (code === 'NOT_FOUND') return <NotFoundState title="Kuitansi tidak ditemukan" text="Nomor kuitansi ini tidak ada atau belum dibayar." linkTo="/my-kos" linkLabel="Ke Kos Saya" />;
    if (code === 'FORBIDDEN') return <NotFoundState title="Tidak dapat dibuka" text={messageForError(q.error)} linkTo="/" linkLabel="Ke Beranda" />;
    return <ErrorState message="Gagal memuat kuitansi." onRetry={() => void q.refetch()} />;
  }

  const k = q.data;
  const period = new Date(`${k.period.dueDate}T00:00:00+07:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

  return (
    <div className="app-container kuitansi-page" style={{ maxWidth: '820px', paddingTop: '2rem', paddingBottom: '4rem' }}>
      <div
        className="kuitansi-paper"
        style={{
          backgroundColor: '#FFFFFF',
          border: '2px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          padding: '2rem',
          position: 'relative',
          boxShadow: 'var(--shadow-sm)',
          color: '#0F172A',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: '2.5rem',
            bottom: '2.5rem',
            border: '3px dashed var(--primary)',
            borderRadius: 'var(--radius-md)',
            padding: '0.6rem 1rem',
            color: 'var(--primary)',
            fontWeight: 800,
            fontSize: '0.85rem',
            textTransform: 'uppercase',
            transform: 'rotate(-10deg)',
            pointerEvents: 'none',
            opacity: 0.85,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <ShieldCheck size={26} />
          <span>LUNAS · TERCATAT</span>
          <span style={{ fontSize: '0.65rem', fontWeight: 600 }}>KOBO</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '1.25rem', borderBottom: '2px solid #E2E8F0', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: 'var(--primary)', color: 'white', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>K</div>
              <span style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                Ko<span style={{ color: 'var(--primary)' }}>Bo</span>
              </span>
            </div>
            <span style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600 }}>BUKTI PEMBAYARAN SEWA</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'block' }}>Nomor Kuitansi:</span>
            <span data-testid="kuitansi-no" style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--primary)' }}>{k.receiptNo}</span>
            <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'block', marginTop: '0.15rem' }}>Tanggal: {longDate(new Date(k.paidAt))}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.9rem' }}>
          <Row label="Telah Terima Dari:">
            <strong>{k.payer.name}</strong>
            {k.payer.campus ? ` (${k.payer.campus})` : ''}
          </Row>
          <Row label="Untuk Pembayaran:">
            Sewa Kamar <strong>Nomor {k.room.roomNumber}</strong> (Lt. {k.room.floor}) pada <strong>{k.kos.name}</strong>, periode {period}
          </Row>
          <Row label="Nama Pengelola / Pemilik:">
            <strong>{k.owner.name}</strong>
          </Row>
          <Row label="Metode Transaksi:">{METHOD_LABEL[k.method]}</Row>
          <div
            style={{
              marginTop: '1rem',
              padding: '1rem 1.25rem',
              backgroundColor: '#F8FAFC',
              borderRadius: '8px',
              border: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#475569' }}>JUMLAH DITERIMA:</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)' }}>{formatRupiah(k.amount)}</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '2.5rem', paddingTop: '1rem', borderTop: '1px solid #E2E8F0' }}>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8', maxWidth: '320px' }}>
            Dokumen ini diterbitkan otomatis oleh sistem KoBo dan sah tanpa tanda tangan basah.
          </div>
          <div style={{ textAlign: 'center', minWidth: '180px' }}>
            <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'block', marginBottom: '1.75rem' }}>Pengelola Kos,</span>
            <span style={{ fontSize: '0.875rem', fontWeight: 700, textDecoration: 'underline' }}>{k.owner.name}</span>
          </div>
        </div>
      </div>

      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
        <Button variant="primary" size="md" onClick={() => window.print()} icon={<Download size={16} />}>
          Unduh PDF
        </Button>
      </div>
    </div>
  );
};
