import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer, CheckCircle2, Ban, FileText } from 'lucide-react';
import { DISCOUNT_LABEL, formatReceiptPeriod, receiptTerbilang } from '@kobo/shared/domain';
import { Button } from '../components/ui/Button';
import { ErrorState, NotFoundState } from '../components/ui/QueryState';
import { useSession } from '../lib/session';
import { useTRPC } from '../lib/trpc';
import { errorCode } from '../lib/queryErrors';
import { messageForError } from '../lib/errors';
import { useAppStore } from '../store/AppContext';
import { formatRupiah } from '../lib/format';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const longDate = (d: Date) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
const paidTime = (d: Date) => `${d.toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB`;

const METHOD_LABEL = {
  MOCK: 'Pembayaran online KoBo',
  XENDIT: 'Pembayaran online terverifikasi (Xendit)',
  MANUAL: 'Dicatat manual oleh pemilik (tunai / transfer)',
} as const;

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="kuitansi-row">
    <dt className="kuitansi-label">{label}</dt>
    <dd className="kuitansi-value">{children}</dd>
  </div>
);

const ReceiptSkeleton: React.FC = () => (
  <div className="app-container kuitansi-page" role="status" aria-busy="true" aria-label="Memuat kuitansi" style={{ maxWidth: '820px', paddingTop: '2rem', paddingBottom: '4rem' }}>
    <div className="kuitansi-paper" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {[40, 70, 55, 80, 35].map((w, i) => <div key={i} className="skeleton" style={{ height: '1.25rem', width: `${w}%` }} />)}
    </div>
  </div>
);

/** /kuitansi/:receiptNo. The tenant who paid or the kos owner. A card on screen, the classic kuitansi anatomy in print ("Cetak / Simpan PDF" is the browser's print dialog). */
export const Kuitansi: React.FC = () => {
  useDocumentTitle('Kuitansi');
  const { receiptNo: param } = useParams();
  const trpc = useTRPC();
  const { me, isLoading } = useSession();
  const { openAuthModal } = useAppStore();
  const number = param && /^\d{1,10}$/.test(param) ? Number(param) : null;
  const q = useQuery({ ...trpc.kuitansi.get.queryOptions({ receiptNo: number ?? 0 }), enabled: !!me && number !== null });

  if (number === null) {
    return <NotFoundState title="Kuitansi tidak ditemukan" text="Nomor kuitansi tidak valid." linkTo="/my-kos" linkLabel="Ke Kos Saya" />;
  }
  if (isLoading) return <ReceiptSkeleton />;
  if (!me) {
    return (
      <div className="app-container" style={{ paddingTop: '4rem', textAlign: 'center', minHeight: '50vh' }}>
        <FileText size={40} color="var(--text-subtle)" aria-hidden="true" style={{ margin: '0 auto 1rem' }} />
        <h1 style={{ fontSize: 'var(--step-2)', fontWeight: 800 }}>Masuk untuk Melihat Kuitansi</h1>
        <p style={{ color: 'var(--text-muted)', margin: '0.5rem auto 1.25rem', maxWidth: '380px' }}>Kuitansi hanya dapat dibuka oleh penyewa yang membayar dan pemilik kosnya.</p>
        <Button variant="primary" size="md" onClick={openAuthModal}>Masuk</Button>
      </div>
    );
  }
  if (q.isPending) return <ReceiptSkeleton />;
  if (q.isError) {
    const code = errorCode(q.error);
    // The server answers NOT_FOUND for unknown, foreign and unpaid numbers alike (no existence oracle), so one message covers all three.
    if (code === 'NOT_FOUND') return <NotFoundState title="Kuitansi belum tersedia" text="Kuitansi tersedia setelah pembayaran lunas." linkTo="/my-kos" linkLabel="Ke Kos Saya" />;
    if (code === 'FORBIDDEN') return <NotFoundState title="Tidak dapat dibuka" text={messageForError(q.error)} linkTo="/" linkLabel="Ke Beranda" />;
    return <ErrorState message="Gagal memuat kuitansi." onRetry={() => void q.refetch()} />;
  }

  const k = q.data;
  const refunded = k.status === 'REFUNDED';
  const words = receiptTerbilang(k.amount);
  const paidAt = new Date(k.paidAt);
  const verifyUrl = `${window.location.origin}/kuitansi/${k.receiptNumber}`;
  const reference = k.manual?.reference ?? k.reference;

  return (
    <div className="app-container kuitansi-page" style={{ maxWidth: '820px', paddingTop: '2rem', paddingBottom: '4rem' }}>
      <article className="kuitansi-paper" aria-labelledby="kuitansi-title">
        <header className="kuitansi-head">
          <div>
            <span className="kuitansi-brand">Ko<span style={{ color: 'var(--primary)' }}>Bo</span></span>
            <h1 id="kuitansi-title" className="kuitansi-title">KUITANSI PEMBAYARAN SEWA</h1>
          </div>
          <div className="kuitansi-meta">
            <span className="kuitansi-label">No. Kuitansi</span>
            <span data-testid="kuitansi-no" className="kuitansi-no tabular-nums">{k.receiptNo}</span>
            <span className={`kuitansi-status${refunded ? ' kuitansi-status--void' : ''}`}>
              {refunded ? <Ban size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
              {refunded ? 'DIBATALKAN' : 'LUNAS'}
            </span>
          </div>
        </header>

        {refunded && <p role="note" className="kuitansi-void">Dibatalkan: pembayaran ini sudah dikembalikan, jadi kuitansi ini tidak berlaku sebagai bukti pembayaran.</p>}

        <dl className="kuitansi-fields">
          <Row label="Telah terima dari">
            <strong>{k.payer.name}</strong>
            {k.payer.campus ? ` (${k.payer.campus})` : ''}
          </Row>
          <Row label="Kos">
            <strong>{k.kos.name}</strong>, {k.kos.address}, {k.kos.city}. Kamar {k.room.roomNumber} (Lt. {k.room.floor})
          </Row>
          {words && <Row label="Uang sejumlah"><em className="kuitansi-words">{words}</em></Row>}
          <Row label="Untuk pembayaran">
            Sewa kamar {k.room.roomNumber}, periode {formatReceiptPeriod(k.period.periodStart, k.period.periodEnd)}
          </Row>
        </dl>

        <dl className="kuitansi-breakdown" aria-label="Rincian pembayaran">
          <div><dt>Sewa kamar</dt><dd className="tabular-nums">{formatRupiah(k.breakdown.rent)}</dd></div>
          {k.breakdown.applicationFee > 0 && <div><dt>Biaya aplikasi</dt><dd className="tabular-nums">{formatRupiah(k.breakdown.applicationFee)}</dd></div>}
          {k.breakdown.discount > 0 && <div><dt>{DISCOUNT_LABEL}</dt><dd className="tabular-nums">-{formatRupiah(k.breakdown.discount)}</dd></div>}
          <div className="kuitansi-breakdown__total"><dt>Total</dt><dd className="tabular-nums">{formatRupiah(k.breakdown.total)}</dd></div>
        </dl>

        <dl className="kuitansi-fields">
          <Row label="Metode pembayaran">
            {k.manual ? `${k.manual.method === 'CASH' ? 'Tunai' : 'Transfer bank'}, dicatat oleh pemilik` : METHOD_LABEL[k.method]}
          </Row>
          {reference && <Row label="No. referensi"><span className="tabular-nums">{reference}</span></Row>}
          <Row label="Waktu dibayar">{paidTime(paidAt)}</Row>
        </dl>

        <div className="kuitansi-foot">
          <div className="kuitansi-rpbox" role="group" aria-label={`Jumlah ${formatRupiah(k.amount)}`}>
            <span aria-hidden="true">{formatRupiah(k.amount)}</span>
          </div>
          <div className="kuitansi-sign">
            <span>{k.kos.city}, {longDate(paidAt)}</span>
            <span>Penerima,</span>
            <strong className="kuitansi-sign__name">{k.owner.name}</strong>
            <span className="kuitansi-sign__note">Disahkan secara elektronik via KoBo</span>
          </div>
        </div>

        <p className="kuitansi-note">Dokumen ini dibuat otomatis oleh KoBo. Keaslian dapat dicek di {verifyUrl}</p>
      </article>

      <div className="no-print kuitansi-actions">
        <Button variant="primary" size="md" onClick={() => window.print()} icon={<Printer size={16} aria-hidden="true" />}>
          Cetak / Simpan PDF
        </Button>
        <span className="kuitansi-hint">Pilih &lsquo;Simpan sebagai PDF&rsquo; di jendela cetak</span>
        <Link to="/my-kos" className="kuitansi-back">Kembali ke Kos Saya</Link>
      </div>
    </div>
  );
};
