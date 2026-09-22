import React, { useState } from 'react';
import { GraduationCap, Upload, CheckCircle2, ShieldCheck, Sparkles, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';

interface KtmUploadCardProps {
  studentDiscountAmount: number;
  onVerificationChange: (isVerified: boolean) => void;
  isInitiallyVerified?: boolean;
}

export const KtmUploadCard: React.FC<KtmUploadCardProps> = ({
  studentDiscountAmount,
  onVerificationChange,
  isInitiallyVerified = true,
}) => {
  const [isVerified, setIsVerified] = useState(isInitiallyVerified);
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState<string>(
    isInitiallyVerified ? 'KTM_Binus_RafiAditya_2024.jpg' : ''
  );

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const handleSimulatedUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploading(true);
      setTimeout(() => {
        setFileName(file.name);
        setIsVerified(true);
        setIsUploading(false);
        onVerificationChange(true);
      }, 700);
    }
  };

  const toggleVerification = () => {
    const next = !isVerified;
    setIsVerified(next);
    onVerificationChange(next);
  };

  return (
    <div
      style={{
        backgroundColor: isVerified ? 'var(--primary-light)' : 'var(--bg-page)',
        border: `1.5px solid ${isVerified ? 'var(--primary)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '1.25rem',
        transition: 'all var(--duration-fast) var(--ease-out-spring)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: isVerified ? 'var(--primary)' : 'var(--bg-muted)',
              color: isVerified ? 'white' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <GraduationCap size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Diskon Mahasiswa Indo
              </h4>
              <span
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'white',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  padding: '0.15rem 0.5rem',
                  borderRadius: 'var(--radius-badge)',
                }}
              >
                HEMAT {formatRupiah(studentDiscountAmount)}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              Unggah Kartu Tanda Mahasiswa (KTM) aktif untuk klaim potongan harga sewa langsung.
            </p>
          </div>
        </div>

        {isVerified && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              color: 'var(--primary)',
              fontSize: '0.785rem',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            <CheckCircle2 size={16} />
            <span>Aktif</span>
          </div>
        )}
      </div>

      {/* Upload Zone / Verified Status */}
      {isVerified ? (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '0.85rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--primary-light)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShieldCheck size={18} />
            </div>
            <div>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', display: 'block' }}>
                KTM Terverifikasi ({fileName || 'KTM Mahasiswa'})
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                Potongan sewa sebesar {formatRupiah(studentDiscountAmount)} / bulan telah diterapkan!
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleVerification}
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Ganti / Lepas
          </button>
        </div>
      ) : (
        <div
          style={{
            border: '1.5px dashed var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            padding: '1.25rem',
            textAlign: 'center',
            backgroundColor: 'var(--bg-surface)',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          <input
            type="file"
            accept="image/*"
            onChange={handleSimulatedUpload}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0,
              cursor: 'pointer',
              width: '100%',
              height: '100%',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem' }}>
            <Upload size={22} color="var(--primary)" />
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {isUploading ? 'Sedang memverifikasi KTM...' : 'Klik atau Tarik Foto KTM di Sini'}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Format PNG, JPG, JPEG (Maks. 5MB)
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
