import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Home, Calendar, FileText, FlaskConical, MessageSquare, ShieldCheck, Star } from 'lucide-react';
import type { MyReview } from '../../../backend/src/trpc/router';
import { ReviewFormModal } from '../components/kos/ReviewFormModal';
import { WaitlistSection } from '../components/booking/WaitlistSection';
import { useAppStore } from '../store/AppContext';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { ErrorState } from '../components/ui/QueryState';
import { useSession } from '../lib/session';
import { useTRPC } from '../lib/trpc';
import { messageForError } from '../lib/errors';
import { formatVisitDate, VISIT_SLOT_LABEL } from '../lib/visits';

const formatRupiah = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

/** 'YYYY-MM-DD' (a WIB calendar day) as "5 Oktober 2026". */
const formatDate = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

const TENANCY_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  booking: { label: 'Menunggu Pembayaran', bg: 'var(--status-due-bg)', color: 'var(--status-due)' },
  paid: { label: 'Sewa Aktif', bg: 'var(--status-paid-bg)', color: 'var(--status-paid)' },
  due: { label: 'Sewa Aktif · Segera Jatuh Tempo', bg: 'var(--status-due-bg)', color: 'var(--status-due)' },
  overdue: { label: 'Menunggak', bg: 'var(--status-overdue-bg)', color: 'var(--status-overdue)' },
  vacant: { label: 'Selesai', bg: 'var(--bg-muted)', color: 'var(--text-muted)' },
};

const Fact: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div>
    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>{label}</span>
    <span style={{ fontSize: '0.9rem', fontWeight: strong ? 800 : 700, color: strong ? 'var(--status-due)' : 'var(--text-main)' }}>{value}</span>
  </div>
);

export const MyKos: React.FC = () => {
  const { addToast, openAuthModal } = useAppStore();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me, isLoading: sessionLoading } = useSession();
  const [activeTab, setActiveTab] = useState<'rentals' | 'visits'>('rentals');
  const [reviewing, setReviewing] = useState<{ tenancyId: string; kosName: string; existing: MyReview | null } | null>(null);

  const mine = useQuery({ ...trpc.booking.mine.queryOptions(), enabled: !!me });
  const visitsQuery = useQuery({ ...trpc.visit.mine.queryOptions(), enabled: !!me });
  const visits = me ? (visitsQuery.data ?? []) : [];
  const scheduledCount = visits.filter((v) => v.status === 'SCHEDULED').length;
  const cancelVisit = useMutation(
    trpc.visit.cancel.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.visit.mine.queryKey() });
        addToast('Jadwal survey telah dibatalkan.', 'info');
      },
    }),
  );
  const simulate = useMutation(
    trpc.payment.simulate.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpc.booking.mine.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.kos.detail.queryKey() });
      },
    }),
  );
  // Lapsed holds and abandoned (never paid) tenancies are noise, not rentals.
  const rentals = (me ? (mine.data ?? []) : []).filter(
    (t) => t.status === 'ACTIVE' || (t.status === 'PENDING' && t.derivedStatus === 'booking') || t.invoices.some((i) => i.status === 'PAID'),
  );

  return (
    <div className="app-container" style={{ maxWidth: '960px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>Kos Saya & Jadwal Survey</h1>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Kelola kamar kos yang sedang Anda sewa, cek jadwal tagihan bulanan, lihat kuitansi resmi, dan pantau survey gratis.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-subtle)', marginBottom: '2rem' }}>
        <button
          onClick={() => setActiveTab('rentals')}
          className="interactive-tap"
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 0.5rem', fontSize: '1rem',
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
            display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 0.5rem', fontSize: '1rem',
            fontWeight: activeTab === 'visits' ? 700 : 500,
            color: activeTab === 'visits' ? 'var(--primary)' : 'var(--text-muted)',
            borderBottom: `2.5px solid ${activeTab === 'visits' ? 'var(--primary)' : 'transparent'}`,
            marginBottom: '-1px',
          }}
        >
          <Calendar size={18} />
          <span>Jadwal Survey Gratis ({scheduledCount})</span>
        </button>
      </div>

      {/* Tab 1: tenancies from the server (booking.mine) */}
      {activeTab === 'rentals' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {!me && !sessionLoading && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
              <Home size={40} color="var(--text-subtle)" style={{ margin: '0 auto 1rem' }} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Masuk untuk Melihat Kos Anda</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.3rem auto 1.25rem', maxWidth: '360px' }}>
                Kamar yang Anda sewa, tagihan bulanan, dan kuitansi tersimpan di akun Anda.
              </p>
              <Button variant="primary" size="md" onClick={openAuthModal}>Masuk</Button>
            </div>
          )}
          {me && mine.isPending && <p role="status" style={{ color: 'var(--text-muted)' }}>Memuat kamar Anda…</p>}
          {me && mine.isError && <ErrorState message="Gagal memuat daftar sewa Anda." onRetry={() => void mine.refetch()} minHeight="10rem" />}
          {simulate.isError && <Notice tone="error">{messageForError(simulate.error)}</Notice>}
          {me && <WaitlistSection />}

          {rentals.map((t) => {
            const badge = TENANCY_BADGE[t.derivedStatus] ?? TENANCY_BADGE.paid;
            const nextInvoice = t.invoices.find((i) => i.status === 'UNPAID');
            const firstReceipt = t.invoices.find((i) => i.receiptNumber !== null);
            return (
              <div
                key={t.id}
                data-testid="tenancy-card"
                data-status={t.status}
                className="card-hover-lift"
                style={{ backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ display: 'flex', gap: '1.25rem' }}>
                    {t.kos.image && <img src={t.kos.image} alt={t.kos.name} style={{ width: '90px', height: '90px', borderRadius: 'var(--radius-md)', objectFit: 'cover', flexShrink: 0 }} />}
                    <div>
                      <span style={{ backgroundColor: badge.bg, color: badge.color, fontSize: '0.75rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: 'var(--radius-xs)' }}>
                        {badge.label}
                      </span>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.35rem' }}>{t.kos.name}</h3>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                        Kamar <strong>{t.room.roomNumber}</strong> (Lt. {t.room.floor}) · {t.kos.address}
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Sewa Bulanan</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)' }}>{formatRupiah(t.room.priceMonthly)}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', display: 'block' }}>/ bulan</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', backgroundColor: 'var(--bg-page)', borderRadius: 'var(--radius-md)', padding: '1rem', border: '1px solid var(--border-subtle)' }}>
                  <Fact label="Mulai Sewa" value={formatDate(t.startDate)} />
                  <Fact label="Durasi Sewa" value={`${t.durationMonths} Bulan`} />
                  <Fact label={t.status === 'PENDING' ? 'Tagihan Pertama' : 'Jatuh Tempo Berikutnya'} value={nextInvoice ? formatDate(nextInvoice.dueDate) : 'Lunas'} strong />
                  <Fact label="Pemilik Kos" value={t.kos.ownerName} />
                </div>

                <div role="table" aria-label="Tagihan" style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
                  {t.invoices.map((inv, i) => (
                    <div key={inv.id} role="row" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.5rem 0', borderTop: i ? '1px solid var(--border-subtle)' : undefined, flexWrap: 'wrap' }}>
                      <span role="cell">Bulan {i + 1} · jatuh tempo {formatDate(inv.dueDate)}</span>
                      <span role="cell" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <strong>{formatRupiah(inv.amount)}</strong>
                        <span style={{ color: inv.status === 'PAID' ? 'var(--status-paid)' : 'var(--text-muted)', fontWeight: 600 }}>{inv.status === 'PAID' ? 'Lunas' : 'Belum dibayar'}</span>
                        {inv.receiptNumber !== null && (
                          <Link to={`/kuitansi/${inv.receiptNumber}`} style={{ color: 'var(--primary)', fontWeight: 600 }}>{inv.receiptNo}</Link>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>
                    <ShieldCheck size={16} />
                    <span>
                      {t.status === 'PENDING' && t.expiresAt
                        ? `Kamar ditahan sampai ${new Date(t.expiresAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`
                        : 'Pembayaran tercatat di KoBo'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {t.pendingPaymentId && (
                      <Button variant="accent" size="sm" isLoading={simulate.isPending} onClick={() => simulate.mutate({ paymentId: t.pendingPaymentId! })} icon={<FlaskConical size={15} />}>
                        Simulasikan Pembayaran
                      </Button>
                    )}
                    {t.canReview && (
                      <Button variant="outline" size="sm" icon={<Star size={15} />} onClick={() => setReviewing({ tenancyId: t.id, kosName: t.kos.name, existing: null })}>
                        Tulis Ulasan
                      </Button>
                    )}
                    {t.review?.editable && (
                      <Button variant="outline" size="sm" icon={<Star size={15} />} onClick={() => setReviewing({ tenancyId: t.id, kosName: t.kos.name, existing: t.review })}>
                        Ubah Ulasan
                      </Button>
                    )}
                    {firstReceipt && (
                      <Link to={`/kuitansi/${firstReceipt.receiptNumber}`}>
                        <Button variant="outline" size="sm" icon={<FileText size={15} />}>Lihat Kuitansi Resmi</Button>
                      </Link>
                    )}
                    {t.kos.ownerPhone && (
                      <a
                        href={`https://wa.me/${t.kos.ownerPhone.replace(/^0/, '62')}?text=${encodeURIComponent(`Halo ${t.kos.ownerName}, saya penghuni Kamar ${t.room.roomNumber}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: 'none' }}
                      >
                        <Button type="button" variant="primary" size="sm" icon={<MessageSquare size={15} />} style={{ backgroundColor: '#25D366', borderColor: '#25D366' }}>
                          Hubungi Pemilik (WA)
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {me && mine.isSuccess && rentals.length === 0 && (
            <div style={{ textAlign: 'center', padding: '4rem 1rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
              <Home size={40} color="var(--text-subtle)" style={{ margin: '0 auto 1rem' }} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Belum Ada Kamar Kos yang Disewa</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.3rem', maxWidth: '360px', margin: '0.3rem auto 1.5rem' }}>
                Temukan kos idaman Anda di sekitar titik lokasi pilihan, klaim diskon mahasiswa, dan bayar dengan mudah.
              </p>
              <Link to="/search">
                <Button variant="primary" size="md">Cari Kos Sekarang</Button>
              </Link>
            </div>
          )}
        </div>
      )}

      {reviewing && <ReviewFormModal onClose={() => setReviewing(null)} {...reviewing} />}

      {/* Tab 2: free visits from the server (visit.mine) */}
      {activeTab === 'visits' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {cancelVisit.isError && <Notice tone="error">{messageForError(cancelVisit.error)}</Notice>}
          {visits.map((vis) => (
            <div
              key={vis.id}
              style={{ backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', padding: '1.25rem', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Calendar size={22} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h4 style={{ fontSize: '1.05rem', fontWeight: 700 }}>{vis.kos.name}</h4>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, backgroundColor: vis.status === 'SCHEDULED' ? 'var(--primary-light)' : 'var(--bg-muted)', color: vis.status === 'SCHEDULED' ? 'var(--primary)' : 'var(--text-muted)', padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-xs)' }}>
                      {vis.status === 'SCHEDULED' ? 'Terjadwal' : vis.status === 'COMPLETED' ? 'Selesai' : 'Dibatalkan'}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    Tanggal: <strong>{formatVisitDate(vis.date)}</strong> · Sesi{' '}
                    <strong>{VISIT_SLOT_LABEL[vis.timeSlot]}</strong>
                  </p>
                  {vis.notes && <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.2rem' }}>Catatan: "{vis.notes}"</p>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Link to={`/kos/${vis.kos.id}`}>
                  <Button variant="outline" size="sm">Lihat Kos</Button>
                </Link>
                {vis.status === 'SCHEDULED' && (
                  <Button variant="ghost" size="sm" isLoading={cancelVisit.isPending} onClick={() => cancelVisit.mutate({ visitId: vis.id })} style={{ color: 'var(--status-overdue)' }}>
                    Batalkan Survey
                  </Button>
                )}
              </div>
            </div>
          ))}

          {(!me || visitsQuery.isSuccess) && visits.length === 0 && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
              <Calendar size={36} color="var(--text-subtle)" style={{ margin: '0 auto 0.75rem' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Belum Ada Jadwal Survey</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Gunakan fitur <strong>Survey Dulu Gratis</strong> di halaman detail kos untuk membuat janji lihat kamar.
              </p>
              <div style={{ marginTop: '1.25rem' }}>
                <Link to="/search">
                  <Button variant="primary" size="sm">Jelajahi Kos Dekat Kampus</Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
