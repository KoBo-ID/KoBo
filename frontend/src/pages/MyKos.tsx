import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Home,
  Calendar,
  FileText,
  Clock,
  MessageSquare,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  User,
} from 'lucide-react';
import { useAppStore } from '../store/AppContext';
import { KuitansiModal } from '../components/owner/KuitansiModal';
import { RentalBooking } from '../types';
import { Button } from '../components/ui/Button';

export const MyKos: React.FC = () => {
  const { rentals, visits, cancelVisit } = useAppStore();
  const [activeTab, setActiveTab] = useState<'rentals' | 'visits'>('rentals');
  const [selectedKuitansiRental, setSelectedKuitansiRental] = useState<RentalBooking | null>(null);

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <div className="app-container" style={{ maxWidth: '960px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      {/* Page Title */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
          Kos Saya & Jadwal Survey
        </h1>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Kelola kamar kos yang sedang Anda sewa, cek jadwal tagihan bulanan, unduh kuitansi resmi, dan pantau survey gratis.
        </p>
      </div>

      {/* Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: '2rem',
        }}
      >
        <button
          onClick={() => setActiveTab('rentals')}
          className="interactive-tap"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 0.5rem',
            fontSize: '1rem',
            fontWeight: activeTab === 'rentals' ? 700 : 500,
            color: activeTab === 'rentals' ? 'var(--primary)' : 'var(--text-muted)',
            borderBottom: `2.5px solid ${activeTab === 'rentals' ? 'var(--primary)' : 'transparent'}`,
            marginBottom: '-1px',
          }}
        >
          <Home size={18} />
          <span>Kamar yang Disewa ({rentals.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('visits')}
          className="interactive-tap"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 0.5rem',
            fontSize: '1rem',
            fontWeight: activeTab === 'visits' ? 700 : 500,
            color: activeTab === 'visits' ? 'var(--primary)' : 'var(--text-muted)',
            borderBottom: `2.5px solid ${activeTab === 'visits' ? 'var(--primary)' : 'transparent'}`,
            marginBottom: '-1px',
          }}
        >
          <Calendar size={18} />
          <span>Jadwal Survey Gratis ({visits.length})</span>
        </button>
      </div>

      {/* Tab 1: Multiple Rented Kos View (Idea.md) */}
      {activeTab === 'rentals' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {rentals.map((rental) => (
            <div
              key={rental.id}
              className="card-hover-lift"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-sm)',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
              }}
            >
              {/* Header with Kos details */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1.25rem' }}>
                  <img
                    src={rental.kosImage}
                    alt={rental.kosName}
                    style={{
                      width: '90px',
                      height: '90px',
                      borderRadius: 'var(--radius-md)',
                      objectFit: 'cover',
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span
                        style={{
                          backgroundColor: 'var(--status-paid-bg)',
                          color: 'var(--status-paid)',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.55rem',
                          borderRadius: 'var(--radius-xs)',
                        }}
                      >
                        Sewa Aktif
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                        No. Kuitansi: {rental.digitalReceiptNumber}
                      </span>
                    </div>

                    <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.35rem' }}>
                      {rental.kosName}
                    </h3>

                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      Kamar <strong>{rental.roomNumber}</strong> · {rental.kosAddress}
                    </p>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                    Sewa Bulanan
                  </span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)' }}>
                    {formatRupiah(rental.monthlyRent)}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', display: 'block' }}>/ bulan</span>
                </div>
              </div>

              {/* Lease Dates & Dues Row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '1rem',
                  backgroundColor: 'var(--bg-page)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                    Mulai Sewa
                  </span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    {rental.leaseStartDate}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                    Durasi Sewa
                  </span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    {rental.leaseDurationMonths} Bulan
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                    Jatuh Tempo Berikutnya
                  </span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--status-due)' }}>
                    {rental.nextDueDate}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                    Pemilik Kos
                  </span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    {rental.ownerName}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>
                  <ShieldCheck size={16} />
                  <span>KTM Terverifikasi · Diskon Mahasiswa Aktif</span>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedKuitansiRental(rental)}
                    icon={<FileText size={15} />}
                  >
                    Lihat Kuitansi Resmi
                  </Button>

                  <a
                    href={`https://wa.me/${rental.ownerPhone.replace(/^0/, '62')}?text=Halo%20${encodeURIComponent(rental.ownerName)},%20saya%20${encodeURIComponent(rental.studentName)}%20penghuni%20Kamar%20${encodeURIComponent(rental.roomNumber)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: 'none' }}
                  >
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      icon={<MessageSquare size={15} />}
                      style={{ backgroundColor: '#25D366', borderColor: '#25D366' }}
                    >
                      Hubungi Pemilik (WA)
                    </Button>
                  </a>
                </div>
              </div>
            </div>
          ))}

          {rentals.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '4rem 1rem',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <Home size={40} color="var(--text-subtle)" style={{ margin: '0 auto 1rem' }} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Belum Ada Kamar Kos yang Disewa</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.3rem', maxWidth: '360px', margin: '0.3rem auto 1.5rem' }}>
                Temukan kos idaman Anda di sekitar kampus dengan diskon mahasiswa dan bayar dengan mudah.
              </p>
              <Link to="/search">
                <Button variant="primary" size="md">
                  Cari Kos Sekarang
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Scheduled Free Visits (Benefit 1) */}
      {activeTab === 'visits' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {visits.map((vis) => (
            <div
              key={vis.id}
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)',
                padding: '1.25rem',
                boxShadow: 'var(--shadow-sm)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--primary-light)',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Calendar size={22} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h4 style={{ fontSize: '1.05rem', fontWeight: 700 }}>{vis.kosName}</h4>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        backgroundColor: 'var(--primary-light)',
                        color: 'var(--primary)',
                        padding: '0.15rem 0.5rem',
                        borderRadius: 'var(--radius-xs)',
                      }}
                    >
                      Terkonfirmasi
                    </span>
                  </div>

                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Tanggal: <strong>{vis.date}</strong> · Sesi{' '}
                    <strong>{vis.timeSlot === 'pagi' ? 'Pagi (09.00 - 12.00)' : 'Siang/Sore (13.00 - 17.00)'}</strong>
                  </p>
                  {vis.notes && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.2rem' }}>
                      Catatan: "{vis.notes}"
                    </p>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Link to={`/kos/${vis.kosId}`}>
                  <Button variant="outline" size="sm">
                    Lihat Kos
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => cancelVisit(vis.id)}
                  style={{ color: 'var(--status-overdue)' }}
                >
                  Batalkan Survey
                </Button>
              </div>
            </div>
          ))}

          {visits.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '3rem 1rem',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <Calendar size={36} color="var(--text-subtle)" style={{ margin: '0 auto 0.75rem' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Belum Ada Jadwal Survey</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Gunakan fitur <strong>Survey Dulu Gratis</strong> di halaman detail kos untuk membuat janji lihat kamar.
              </p>
              <div style={{ marginTop: '1.25rem' }}>
                <Link to="/search">
                  <Button variant="primary" size="sm">
                    Jelajahi Kos Dekat Kampus
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Official Kuitansi Digital Modal */}
      {selectedKuitansiRental && (
        <KuitansiModal
          isOpen={!!selectedKuitansiRental}
          onClose={() => setSelectedKuitansiRental(null)}
          rental={selectedKuitansiRental}
        />
      )}
    </div>
  );
};
