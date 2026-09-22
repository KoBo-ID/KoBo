import React, { useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  CreditCard,
  QrCode,
  ShieldCheck,
  GraduationCap,
  Calendar,
  CheckCircle2,
  Lock,
  Building,
  Footprints,
} from 'lucide-react';
import { useAppStore } from '../store/AppContext';
import { KtmUploadCard } from '../components/booking/KtmUploadCard';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export const Checkout: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const { kosList, currentUser, createRentalBooking, addToast } = useAppStore();

  const kos = kosList.find((k) => k.id === id) || kosList[0];
  const roomId = searchParams.get('room');
  const durationParam = Number(searchParams.get('duration')) || 1;

  const selectedRoom = kos.rooms.find((r) => r.id === roomId) || kos.rooms[0];

  // Student discount verification state (Benefit 2)
  const [ktmVerified, setKtmVerified] = useState<boolean>(currentUser.ktmVerified ?? true);
  const [studentName, setStudentName] = useState(currentUser.name);
  const [studentPhone, setStudentPhone] = useState(currentUser.phone);
  const [studentCampus, setStudentCampus] = useState(currentUser.campus || 'Binus University (Syahdan)');
  const [leaseDuration, setLeaseDuration] = useState<number>(durationParam);

  // Payment Selection
  const [paymentType, setPaymentType] = useState<'bca_va' | 'mandiri_va' | 'qris'>('bca_va');
  const [isProcessing, setIsProcessing] = useState(false);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const baseMonthly = selectedRoom.priceMonthly;
  const discountAmount = ktmVerified ? kos.studentDiscountAmount : 0;
  const applicationFee = 25000; // Platform insurance & application fee per idea.md
  const totalFirstMonth = baseMonthly - discountAmount + applicationFee;

  const handlePayNow = (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);

    setTimeout(() => {
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
        studentName,
        studentPhone,
        studentCampus,
        ktmVerified,
        monthlyRent: baseMonthly,
        applicationFee,
        studentDiscount: discountAmount,
        totalPaid: totalFirstMonth,
        paymentMethod: paymentType,
        paymentStatus: 'paid',
        leaseStartDate: now.toISOString().split('T')[0],
        leaseDurationMonths: leaseDuration,
        nextDueDate: nextDue.toISOString().split('T')[0],
        ownerName: kos.owner.name,
        ownerPhone: kos.owner.phone,
      });

      setIsProcessing(false);
      navigate('/my-kos');
    }, 800);
  };

  return (
    <div className="app-container" style={{ maxWidth: '960px', paddingTop: '1.5rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
          Formulir Pengajuan Sewa & Pembayaran
        </h1>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Selesaikan data penyewa dan klaim diskon KTM sebelum melakukan transfer.
        </p>
      </div>

      <form onSubmit={handlePayNow}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '2rem',
            alignItems: 'start',
          }}
          className="checkout-split-layout"
        >
          {/* Left Form: Tenant Info & KTM & Payment Method */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
            {/* Benefit 2: KTM Upload Card */}
            <KtmUploadCard
              studentDiscountAmount={kos.studentDiscountAmount}
              onVerificationChange={(v) => setKtmVerified(v)}
              isInitiallyVerified={ktmVerified}
            />

            {/* Tenant Details */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)',
                padding: '1.5rem',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>
                Data Diri Penyewa
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                <Input
                  label="Nama Lengkap Sesuai KTP / KTM"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  required
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <Input
                    label="Nomor WhatsApp Aktif"
                    value={studentPhone}
                    onChange={(e) => setStudentPhone(e.target.value)}
                    required
                  />
                  <Input
                    label="Asal Universitas / Kampus"
                    value={studentCampus}
                    onChange={(e) => setStudentCampus(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)',
                padding: '1.5rem',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>
                Pilih Metode Pembayaran
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <label
                  className="interactive-tap"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${paymentType === 'bca_va' ? 'var(--primary)' : 'var(--border-subtle)'}`,
                    backgroundColor: paymentType === 'bca_va' ? 'var(--primary-light)' : 'var(--bg-surface)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentType === 'bca_va'}
                      onChange={() => setPaymentType('bca_va')}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'block' }}>
                        BCA Virtual Account
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Verifikasi instan 24 jam · Bebas biaya admin transfer
                      </span>
                    </div>
                  </div>
                  <CreditCard size={20} color="var(--primary)" />
                </label>

                <label
                  className="interactive-tap"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${paymentType === 'mandiri_va' ? 'var(--primary)' : 'var(--border-subtle)'}`,
                    backgroundColor: paymentType === 'mandiri_va' ? 'var(--primary-light)' : 'var(--bg-surface)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentType === 'mandiri_va'}
                      onChange={() => setPaymentType('mandiri_va')}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'block' }}>
                        Mandiri Virtual Account
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Konfirmasi instan via Livin' by Mandiri
                      </span>
                    </div>
                  </div>
                  <CreditCard size={20} color="var(--primary)" />
                </label>

                <label
                  className="interactive-tap"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${paymentType === 'qris' ? 'var(--primary)' : 'var(--border-subtle)'}`,
                    backgroundColor: paymentType === 'qris' ? 'var(--primary-light)' : 'var(--bg-surface)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentType === 'qris'}
                      onChange={() => setPaymentType('qris')}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'block' }}>
                        QRIS (Semua E-Wallet & Mobile Banking)
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        GoPay, OVO, Dana, ShopeePay, BCA, Mandiri
                      </span>
                    </div>
                  </div>
                  <QrCode size={20} color="var(--primary)" />
                </label>
              </div>
            </div>
          </div>

          {/* Right Summary Card (Sticky) */}
          <div
            style={{
              position: 'sticky',
              top: 'calc(var(--header-height) + 20px)',
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-xl)',
              border: '1.5px solid var(--border-strong)',
              boxShadow: 'var(--shadow-md)',
              padding: '1.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            {/* Kos Summary Info */}
            <div style={{ display: 'flex', gap: '1rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--border-subtle)' }}>
              <img
                src={kos.images[0]}
                alt={kos.name}
                style={{
                  width: '75px',
                  height: '75px',
                  borderRadius: 'var(--radius-md)',
                  objectFit: 'cover',
                }}
              />
              <div>
                <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.3 }}>
                  {kos.name}
                </h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Kamar {selectedRoom.roomNumber} ({selectedRoom.roomType})
                </p>
                <p style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600, marginTop: '0.2rem' }}>
                  <Footprints size={12} /> {kos.campusProximity.distanceMeters}m ke {kos.campusProximity.campusName}
                </p>
              </div>
            </div>

            {/* Rincian Biaya Transparan */}
            <div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.75rem' }}>
                Rincian Biaya Transparan (Idea.md)
              </span>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.875rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                  <span>Sewa Kamar 1 Bulan</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{formatRupiah(baseMonthly)}</span>
                </div>

                {ktmVerified && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--primary)' }}>
                    <span>Diskon Mahasiswa Indo (KTM)</span>
                    <span style={{ fontWeight: 700 }}>- {formatRupiah(discountAmount)}</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span>Biaya Aplikasi KoBo</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--primary)', backgroundColor: 'var(--primary-light)', padding: '0.1rem 0.35rem', borderRadius: 'var(--radius-xs)' }}>
                      Application Fee
                    </span>
                  </div>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{formatRupiah(applicationFee)}</span>
                </div>

                <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '0.35rem 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.25rem', fontWeight: 800 }}>
                  <span style={{ color: 'var(--text-main)' }}>Total Tagihan</span>
                  <span style={{ color: 'var(--primary)' }}>{formatRupiah(totalFirstMonth)}</span>
                </div>
              </div>
            </div>

            {/* Pay Button */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              isLoading={isProcessing}
              icon={<Lock size={16} />}
            >
              Bayar Sekarang ({formatRupiah(totalFirstMonth)})
            </Button>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
              <ShieldCheck size={14} color="var(--primary)" />
              <span>Transaksi Terenkripsi SSL 256-Bit & Sah Resmi</span>
            </div>
          </div>
        </div>
      </form>

      <style>{`
        @media (min-width: 1024px) {
          .checkout-split-layout {
            grid-template-columns: 58fr 42fr !important;
          }
        }
      `}</style>
    </div>
  );
};
