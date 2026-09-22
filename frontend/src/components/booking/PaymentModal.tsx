import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, QrCode, Copy, CheckCircle2, ShieldAlert, Sparkles, Building } from 'lucide-react';
import { Kos, Room } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useAppStore } from '../../store/AppContext';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  kos: Kos;
  selectedRoom: Room;
  studentDiscountApplied: boolean;
  leaseDurationMonths: number;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  kos,
  selectedRoom,
  studentDiscountApplied,
  leaseDurationMonths,
}) => {
  const navigate = useNavigate();
  const { currentUser, createRentalBooking, addToast } = useAppStore();
  const [paymentTab, setPaymentTab] = useState<'va' | 'qris'>('va');
  const [selectedBank, setSelectedBank] = useState<'bca' | 'mandiri' | 'bri'>('bca');
  const [isProcessing, setIsProcessing] = useState(false);
  const [copied, setCopied] = useState(false);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const baseMonthly = selectedRoom.priceMonthly;
  const discountAmount = studentDiscountApplied ? kos.studentDiscountAmount : 0;
  const applicationFee = 25000; // Transparent application fee per idea.md
  const totalDue = baseMonthly - discountAmount + applicationFee;

  const vaNumbers: Record<string, string> = {
    bca: '89108 081234567890',
    mandiri: '88790 081234567890',
    bri: '12890 081234567890',
  };

  const handleCopyVA = () => {
    navigator.clipboard.writeText(vaNumbers[selectedBank]);
    setCopied(true);
    addToast('Nomor Virtual Account berhasil disalin!', 'success');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleConfirmPayment = () => {
    setIsProcessing(true);
    setTimeout(() => {
      // Calculate next due date (1 month from now)
      const now = new Date();
      const nextDue = new Date();
      nextDue.setMonth(now.getMonth() + 1);

      createRentalBooking({
        kosId: kos.id,
        kosName: kos.name,
        kosImage: kos.images[0],
        kosAddress: kos.address,
        roomId: selectedRoom.id,
        roomNumber: `${selectedRoom.roomNumber} (Lt. ${selectedRoom.floor})`,
        studentName: currentUser.name,
        studentPhone: currentUser.phone,
        studentCampus: currentUser.campus || 'Mahasiswa Binus',
        ktmVerified: studentDiscountApplied,
        monthlyRent: baseMonthly,
        applicationFee,
        studentDiscount: discountAmount,
        totalPaid: totalDue,
        paymentMethod: paymentTab === 'qris' ? 'qris' : (`${selectedBank}_va` as any),
        paymentStatus: 'paid',
        leaseStartDate: now.toISOString().split('T')[0],
        leaseDurationMonths,
        nextDueDate: nextDue.toISOString().split('T')[0],
        ownerName: kos.owner.name,
        ownerPhone: kos.owner.phone,
      });

      setIsProcessing(false);
      onClose();
      navigate('/my-kos');
    }, 900);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <CreditCard size={20} color="var(--primary)" />
          <span>Selesaikan Pembayaran Sewa</span>
        </div>
      }
      subtitle={`Kamar ${selectedRoom.roomNumber} · ${kos.name}`}
      maxWidth="md"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Transparent Cost Breakdown */}
        <div
          style={{
            backgroundColor: 'var(--bg-page)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem',
          }}
        >
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.75rem' }}>
            Rincian Biaya Transparan (Idea.md)
          </span>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Sewa Kamar Bulan Pertama</span>
              <span style={{ fontWeight: 600 }}>{formatRupiah(baseMonthly)}</span>
            </div>

            {studentDiscountApplied && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--primary)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span>Diskon Mahasiswa Indo (KTM)</span>
                </span>
                <span style={{ fontWeight: 700 }}>- {formatRupiah(discountAmount)}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Biaya Layanan & Asuransi KoBo</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--primary)', backgroundColor: 'var(--primary-light)', padding: '0.1rem 0.35rem', borderRadius: 'var(--radius-xs)' }}>
                  Application Fee
                </span>
              </div>
              <span style={{ fontWeight: 600 }}>{formatRupiah(applicationFee)}</span>
            </div>

            <div style={{ height: '1px', backgroundColor: 'var(--border-strong)', margin: '0.35rem 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 800 }}>
              <span style={{ color: 'var(--text-main)' }}>Total Pembayaran Pertama</span>
              <span style={{ color: 'var(--primary)' }}>{formatRupiah(totalDue)}</span>
            </div>
          </div>
        </div>

        {/* Payment Methods Tab */}
        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>
            Pilih Metode Pembayaran:
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
            <button
              type="button"
              onClick={() => setPaymentTab('va')}
              className="interactive-tap"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.65rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${paymentTab === 'va' ? 'var(--primary)' : 'var(--border-strong)'}`,
                backgroundColor: paymentTab === 'va' ? 'var(--primary-light)' : 'var(--bg-surface)',
                color: paymentTab === 'va' ? 'var(--primary)' : 'var(--text-muted)',
                fontWeight: 700,
                fontSize: '0.875rem',
              }}
            >
              <CreditCard size={18} />
              <span>Virtual Account</span>
            </button>

            <button
              type="button"
              onClick={() => setPaymentTab('qris')}
              className="interactive-tap"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.65rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${paymentTab === 'qris' ? 'var(--primary)' : 'var(--border-strong)'}`,
                backgroundColor: paymentTab === 'qris' ? 'var(--primary-light)' : 'var(--bg-surface)',
                color: paymentTab === 'qris' ? 'var(--primary)' : 'var(--text-muted)',
                fontWeight: 700,
                fontSize: '0.875rem',
              }}
            >
              <QrCode size={18} />
              <span>QRIS (Instan)</span>
            </button>
          </div>

          {/* Virtual Account Options */}
          {paymentTab === 'va' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(['bca', 'mandiri', 'bri'] as const).map((bank) => (
                  <button
                    key={bank}
                    type="button"
                    onClick={() => setSelectedBank(bank)}
                    className="interactive-tap"
                    style={{
                      flex: 1,
                      padding: '0.5rem 0.25rem',
                      borderRadius: 'var(--radius-sm)',
                      border: `1.5px solid ${selectedBank === bank ? 'var(--primary)' : 'var(--border-subtle)'}`,
                      backgroundColor: selectedBank === bank ? 'var(--bg-surface)' : 'var(--bg-page)',
                      fontWeight: 800,
                      fontSize: '0.85rem',
                      textTransform: 'uppercase',
                      color: selectedBank === bank ? 'var(--primary)' : 'var(--text-muted)',
                      boxShadow: selectedBank === bank ? 'var(--shadow-sm)' : 'none',
                    }}
                  >
                    Bank {bank}
                  </button>
                ))}
              </div>

              {/* VA Display Box */}
              <div
                style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px dashed var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                    Nomor Virtual Account Bank {selectedBank.toUpperCase()}:
                  </span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '0.05em', color: 'var(--text-main)' }}>
                    {vaNumbers[selectedBank]}
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={handleCopyVA} icon={<Copy size={14} />}>
                  {copied ? 'Disalin!' : 'Salin'}
                </Button>
              </div>
            </div>
          ) : (
            /* QRIS Simulated Barcode */
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.75rem',
                backgroundColor: 'var(--bg-page)',
                padding: '1.25rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {/* QR Code SVG */}
              <div
                style={{
                  backgroundColor: 'white',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <svg width="150" height="150" viewBox="0 0 100 100" fill="none">
                  <rect width="100" height="100" fill="white" />
                  <rect x="10" y="10" width="30" height="30" fill="#0F172A" />
                  <rect x="15" y="15" width="20" height="20" fill="white" />
                  <rect x="20" y="20" width="10" height="10" fill="#0F172A" />

                  <rect x="60" y="10" width="30" height="30" fill="#0F172A" />
                  <rect x="65" y="15" width="20" height="20" fill="white" />
                  <rect x="70" y="20" width="10" height="10" fill="#0F172A" />

                  <rect x="10" y="60" width="30" height="30" fill="#0F172A" />
                  <rect x="15" y="65" width="20" height="20" fill="white" />
                  <rect x="20" y="70" width="10" height="10" fill="#0F172A" />

                  <rect x="45" y="45" width="10" height="10" fill="#1D8758" />
                  <rect x="45" y="20" width="5" height="15" fill="#0F172A" />
                  <rect x="60" y="60" width="15" height="5" fill="#0F172A" />
                  <rect x="80" y="75" width="10" height="15" fill="#0F172A" />
                  <rect x="60" y="80" width="10" height="10" fill="#0F172A" />
                </svg>
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Scan menggunakan GoPay, OVO, Dana, BCA Mobile, atau Livin' Mandiri
              </span>
            </div>
          )}
        </div>

        {/* Confirmation Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="button"
            variant="primary"
            isLoading={isProcessing}
            onClick={handleConfirmPayment}
            icon={<CheckCircle2 size={16} />}
          >
            Simulasi Bayar Sekarang ({formatRupiah(totalDue)})
          </Button>
        </div>
      </div>
    </Modal>
  );
};
