import React, { useRef } from 'react';
import { Printer, Download, Share2, ShieldCheck, CheckCircle2, FileText, Check } from 'lucide-react';
import { Room, Kos, RentalBooking } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAppStore } from '../../store/AppContext';

interface KuitansiModalProps {
  isOpen: boolean;
  onClose: () => void;
  room?: Room | null;
  rental?: RentalBooking | null;
  kos?: Kos | null;
}

export const KuitansiModal: React.FC<KuitansiModalProps> = ({
  isOpen,
  onClose,
  room,
  rental,
  kos,
}) => {
  const { addToast } = useAppStore();
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const receiptNum = rental?.digitalReceiptNumber || `KB-KOB-202609-${Math.floor(1000 + Math.random() * 9000)}`;
  const tenantName = rental?.studentName || room?.tenantName || 'Penghuni Mahasiswa';
  const tenantCampus = rental?.studentCampus || room?.tenantCampus || 'Binus Syahdan';
  const roomNumber = rental?.roomNumber || room?.roomNumber || '101';
  const kosName = rental?.kosName || kos?.name || 'Kost Wisma Sakura Syahdan';
  const ownerName = rental?.ownerName || kos?.owner.name || 'Ibu Ratna Hendrawan';
  const amount = rental?.totalPaid || room?.priceMonthly || 1650000;
  const payDate = rental?.createdAt ? new Date(rental.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '04 September 2026';

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    addToast(`Kuitansi digital ${receiptNum} berhasil diunduh!`, 'success');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FileText size={20} color="var(--primary)" />
          <span>Kuitansi Digital Resmi KoBo</span>
        </div>
      }
      subtitle={`No. Registrasi Kuitansi: ${receiptNum}`}
      maxWidth="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Printable Receipt Paper Container */}
        <div
          ref={printRef}
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
          {/* Receipt Watermark Stamp */}
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
            <span>LUNAS · TERVERIFIKASI</span>
            <span style={{ fontSize: '0.65rem', fontWeight: 600 }}>KOBO SECURE VERIFIED</span>
          </div>

          {/* Receipt Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              paddingBottom: '1.25rem',
              borderBottom: '2px solid #E2E8F0',
              marginBottom: '1.5rem',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--primary)',
                    color: 'white',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  K
                </div>
                <span style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                  Ko<span style={{ color: 'var(--primary)' }}>Bo</span>
                </span>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 600 }}>
                BUKTI PEMBAYARAN SEWA SAH
              </span>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'block' }}>Nomor Kuitansi:</span>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--primary)' }}>
                {receiptNum}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'block', marginTop: '0.15rem' }}>
                Tanggal: {payDate}
              </span>
            </div>
          </div>

          {/* Receipt Body Table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.9rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '0.5rem' }}>
              <span style={{ color: '#64748B', fontWeight: 600 }}>Telah Terima Dari:</span>
              <span style={{ fontWeight: 700 }}>
                {tenantName} ({tenantCampus})
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '0.5rem' }}>
              <span style={{ color: '#64748B', fontWeight: 600 }}>Untuk Pembayaran:</span>
              <span>
                Sewa Kamar <strong>Nomor {roomNumber}</strong> pada <strong>{kosName}</strong>
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '0.5rem' }}>
              <span style={{ color: '#64748B', fontWeight: 600 }}>Nama Pengelola / Pemilik:</span>
              <span style={{ fontWeight: 600 }}>{ownerName}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '0.5rem' }}>
              <span style={{ color: '#64748B', fontWeight: 600 }}>Metode Transaksi:</span>
              <span>Transfer Virtual Account / QRIS (Otomatis Tervalidasi)</span>
            </div>

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
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#475569' }}>
                JUMLAH DITERIMA:
              </span>
              <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--primary)' }}>
                {formatRupiah(amount)}
              </span>
            </div>
          </div>

          {/* Receipt Footer Signature */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              marginTop: '2.5rem',
              paddingTop: '1rem',
              borderTop: '1px solid #E2E8F0',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: '#94A3B8', maxWidth: '320px' }}>
              Dokumen ini diterbitkan secara otomatis oleh sistem KoBo Indonesia dan sah tanpa tanda tangan basah fisik.
            </div>

            <div style={{ textAlign: 'center', minWidth: '180px' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'block', marginBottom: '1.75rem' }}>
                Pengelola Kos,
              </span>
              <span style={{ fontSize: '0.875rem', fontWeight: 700, textDecoration: 'underline' }}>
                {ownerName}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button variant="outline" size="sm" onClick={handlePrint} icon={<Printer size={15} />}>
            Cetak Kuitansi
          </Button>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Tutup
            </Button>
            <Button variant="primary" size="sm" onClick={handleDownloadPDF} icon={<Download size={15} />}>
              Unduh File PDF
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
