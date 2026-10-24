import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Home, Calendar, FileText, MessageSquare, ShieldCheck, Star, ClipboardList } from 'lucide-react';
import type { MyReview, MyTenancy } from '../../../backend/src/trpc/router';
import { ReviewFormModal } from '../components/kos/ReviewFormModal';
import { InvoicePaymentActions } from '../components/booking/InvoicePaymentActions';
import { WaitlistSection } from '../components/booking/WaitlistSection';
import { useAppStore } from '../store/AppContext';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { ErrorState } from '../components/ui/QueryState';
import { SafeImage } from '../components/ui/SafeImage';
import { useSession } from '../lib/session';
import { useTRPC } from '../lib/trpc';
import { messageForError } from '../lib/errors';
import { formatVisitDate, VISIT_SLOT_LABEL } from '../lib/visits';
import { formatRupiah } from '../lib/format';
/** 'YYYY-MM-DD' (a WIB calendar day) as "5 Oktober 2026". */
const formatDate = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

const TENANCY_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  booking: { label: 'Menunggu Pembayaran', bg: 'var(--status-due-bg)', color: 'var(--status-due-text)' },
  paid: { label: 'Sewa Aktif', bg: 'var(--status-paid-bg)', color: 'var(--status-paid-text)' },
  due: { label: 'Sewa Aktif · Segera Jatuh Tempo', bg: 'var(--status-due-bg)', color: 'var(--status-due-text)' },
  overdue: { label: 'Menunggak', bg: 'var(--status-overdue-bg)', color: 'var(--status-overdue-text)' },
  vacant: { label: 'Selesai', bg: 'var(--bg-muted)', color: 'var(--text-muted)' },
};

const APPLICATION_BADGE = {
  PENDING: { label: 'Menunggu Pemilik', bg: 'var(--status-due-bg)', color: 'var(--status-due-text)' },
  APPROVED: { label: 'Diterima', bg: 'var(--status-paid-bg)', color: 'var(--status-paid-text)' },
  REJECTED: { label: 'Tidak Diterima', bg: 'var(--status-overdue-bg)', color: 'var(--status-overdue-text)' },
  WITHDRAWN: { label: 'Dibatalkan', bg: 'var(--bg-muted)', color: 'var(--text-muted)' },
} as const;

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
  const [searchParams, setSearchParams] = useSearchParams();
  // From the gateway return URL. Only used to start a short wait; the server decides what actually happened.
  const returnedPayment = searchParams.get('payment');
  const [chosenTab, setActiveTab] = useState<'rentals' | 'applications' | 'visits' | null>(null);
  const [reviewing, setReviewing] = useState<{ tenancyId: string; kosName: string; existing: MyReview | null } | null>(null);

  const mine = useQuery({ ...trpc.booking.mine.queryOptions(), enabled: !!me });
  const applicationQuery = useQuery({ ...trpc.application.mine.queryOptions(), enabled: !!me });
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
  // Lapsed holds and abandoned (never paid) tenancies are noise, not rentals.
  // A lapsed hold that took a late payment stays visible, so the tenant can see the refund instead of silence.
  const refunding = (t: MyTenancy) => t.invoices.some((i) => i.latestPayment?.status.startsWith('REFUND_'));
  const rentals = (me ? (mine.data ?? []) : []).filter(
    (t) => t.status === 'ACTIVE' || (t.status === 'PENDING' && t.derivedStatus === 'booking') || t.invoices.some((i) => i.status === 'PAID') || refunding(t),
  );
  const liveCardFor = (a: { kos: { id: string }; room: { roomNumber: string } }) =>
    rentals.some((t) => t.kos.id === a.kos.id && t.room.roomNumber === a.room.roomNumber && (t.status === 'ACTIVE' || t.derivedStatus === 'booking'));
  const applications = me ? (applicationQuery.data ?? []) : [];
  // What an approved application says depends on what became of its tenancy: still waiting for payment, paid and
  // later ended, or never paid within the 24 hours (the room is released and the tenancy is no longer live).
  const approvedNote = (a: { kos: { id: string }; room: { roomNumber: string } }) => {
    if (liveCardFor(a)) return 'Pengajuan diterima. Bayar tagihan pertama di tab Kamar yang Disewa sebelum batas waktunya.';
    const ended = rentals.some((t) => t.kos.id === a.kos.id && t.room.roomNumber === a.room.roomNumber && t.status === 'ENDED');
    return ended
      ? 'Pengajuan diterima dan sewanya sudah berakhir.'
      : 'Pengajuan diterima, tetapi tagihan pertama tidak dibayar dalam 24 jam, jadi kamar dilepas. Ajukan lagi bila kamar masih tersedia.';
  };
  // Until the user picks a tab, a student who only has pending applications lands on Pengajuan sewa.
  const activeTab = chosenTab ?? (rentals.length === 0 && applications.length > 0 ? 'applications' : 'rentals');

  // A return link that matches no invoice, or an invoice that is already settled, must not linger in the URL.
  useEffect(() => {
    if (!returnedPayment || !mine.isSuccess) return;
    const inv = (mine.data ?? []).flatMap((t) => t.invoices).find((i) => i.activePayment?.id === returnedPayment || i.latestPayment?.id === returnedPayment);
    if (!inv) {
      addToast('Pembayaran tidak ditemukan di akun Anda.', 'info');
    } else if (inv.status === 'PAID') {
      addToast('Pembayaran sudah tercatat. Kuitansi tersedia di kartu kamar.', 'success');
    } else {
      return; // still pending: InvoicePaymentActions waits and clears it
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnedPayment, mine.isSuccess]);

  return (
    <div className="app-container" style={{ maxWidth: '960px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 className="page-title">Kos Saya & Jadwal Survey</h1>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Kelola kamar kos yang sedang Anda sewa, cek jadwal tagihan bulanan, lihat kuitansi resmi, dan pantau survey gratis.
        </p>
      </div>

      <div role="tablist" aria-label="Kos Saya" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-subtle)', marginBottom: '2rem' }}>
        {([
          { id: 'rentals', icon: <Home size={18} />, label: `Kamar yang Disewa (${rentals.length})` },
          { id: 'applications', icon: <ClipboardList size={18} />, label: `Pengajuan Sewa (${applications.length})` },
          { id: 'visits', icon: <Calendar size={18} />, label: `Jadwal Survey Gratis (${scheduledCount})` },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="interactive-tap"
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 0.5rem', fontSize: '1rem',
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: `2.5px solid ${activeTab === tab.id ? 'var(--primary)' : 'transparent'}`,
              marginBottom: '-1px',
            }}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
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
                    {t.kos.image && <SafeImage src={t.kos.image} alt={t.kos.name} style={{ width: '90px', height: '90px', borderRadius: 'var(--radius-md)', objectFit: 'cover', flexShrink: 0 }} />}
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
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>/ bulan</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', padding: '1rem 0', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <Fact label="Mulai Sewa" value={formatDate(t.startDate)} />
                  <Fact label="Durasi Sewa" value={`${t.durationMonths} Bulan`} />
                  <Fact label={t.status === 'PENDING' ? 'Tagihan Pertama' : 'Jatuh Tempo Berikutnya'} value={nextInvoice ? formatDate(nextInvoice.dueDate) : 'Lunas'} strong />
                  <Fact label="Pemilik Kos" value={t.kos.ownerName} />
                </div>

                <div role="table" aria-label="Tagihan" style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem' }}>
                  {t.invoices.map((inv, i) => (
                    <div key={inv.id} role="row" className="invoice-row" style={{ borderTop: i ? '1px solid var(--border-subtle)' : undefined }}>
                      <span role="cell">Bulan {i + 1} · jatuh tempo {formatDate(inv.dueDate)}</span>
                      <span role="cell" className="invoice-row__meta">
                        <strong>{formatRupiah(inv.amount)}</strong>
                        <span style={{ color: inv.status === 'PAID' ? 'var(--status-paid)' : 'var(--text-muted)', fontWeight: 600 }}>{inv.status === 'PAID' ? 'Lunas' : t.status === 'ENDED' ? 'Tidak ditagih, sewa berakhir' : 'Belum dibayar'}</span>
                        <InvoicePaymentActions
                          invoice={inv}
                          returnedPaymentId={returnedPayment && (inv.activePayment?.id === returnedPayment || inv.latestPayment?.id === returnedPayment) ? returnedPayment : undefined}
                          onResolved={() => setSearchParams({}, { replace: true })}
                        />
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
                      {t.status === 'ENDED'
                        ? `Sewa berakhir${t.endedAt ? ` pada ${new Date(t.endedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}`
                        : t.status === 'PENDING' && t.expiresAt
                          ? `Kamar ditahan sampai ${new Date(t.expiresAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`
                          : 'Pembayaran tercatat di KoBo'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
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
                        <Button type="button" variant="primary" size="sm" icon={<MessageSquare size={15} />} style={{ backgroundColor: 'var(--whatsapp)', borderColor: 'var(--whatsapp)' }}>
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
                Cari kos, jadwalkan survey, lalu ajukan sewa. Kamar yang Anda sewa muncul di sini.</p>
              <Link to="/search">
                <Button variant="primary" size="md">Cari Kos Sekarang</Button>
              </Link>
            </div>
          )}
        </div>
      )}

      {reviewing && <ReviewFormModal onClose={() => setReviewing(null)} {...reviewing} />}

      {/* Tab 2: rental applications (application.mine) */}
      {activeTab === 'applications' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {!me && !sessionLoading && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
              <ClipboardList size={40} color="var(--text-subtle)" style={{ margin: '0 auto 1rem' }} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Masuk untuk melihat pengajuan Anda</h3>
              <Button variant="primary" size="md" onClick={openAuthModal} style={{ marginTop: '1rem' }}>Masuk</Button>
            </div>
          )}
          {me && applicationQuery.isPending && <p role="status" style={{ color: 'var(--text-muted)' }}>Memuat pengajuan Anda…</p>}
          {me && applicationQuery.isError && <ErrorState message="Gagal memuat pengajuan sewa Anda." onRetry={() => void applicationQuery.refetch()} minHeight="8rem" />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {applications.map((application) => {
                const badge = APPLICATION_BADGE[application.status];
                return (
                  <div key={application.id} data-testid="application-card" className="application-card">
                    <div className="application-card__main">
                      {application.kos.image ? <SafeImage src={application.kos.image} alt="" iconSize={20} style={{ width: '52px', height: '52px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} /> : <ClipboardList size={24} color="var(--text-subtle)" />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <strong>{application.kos.name}</strong>
                          <span style={{ backgroundColor: badge.bg, color: badge.color, fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-xs)' }}>{badge.label}</span>
                        </div>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Kamar {application.room.roomNumber} · mulai {formatDate(application.startDate)} · {application.durationMonths} bulan</p>
                        {application.status === 'PENDING' && <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Kamar belum ditahan. Pemilik sedang meninjau pengajuan.</p>}
                        {application.status === 'APPROVED' && <p style={{ fontSize: '0.76rem', color: liveCardFor(application) ? 'var(--status-paid-text)' : 'var(--text-muted)', marginTop: '0.15rem' }}>{approvedNote(application)}</p>}
                      </div>
                    </div>
                    <Link to={`/kos/${application.kos.id}`} className="application-card__action"><Button variant="outline" size="sm">Lihat Kos</Button></Link>
                  </div>
                );
              })}
            </div>
          {me && applicationQuery.isSuccess && applications.length === 0 && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
              <ClipboardList size={40} color="var(--text-subtle)" style={{ margin: '0 auto 1rem' }} />
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Belum ada pengajuan sewa</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.3rem auto 1.25rem', maxWidth: '360px' }}>
                Pilih kamar di halaman kos, lalu kirim pengajuan. Statusnya muncul di sini sampai pemilik memutuskan.</p>
              <Link to="/search">
                <Button variant="primary" size="md">Cari kos</Button>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: free visits from the server (visit.mine) */}
      {activeTab === 'visits' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {cancelVisit.isError && <Notice tone="error">{messageForError(cancelVisit.error)}</Notice>}
          {me && visitsQuery.isPending && <p role="status" style={{ color: 'var(--text-muted)' }}>Memuat jadwal survey…</p>}
          {me && visitsQuery.isError && <ErrorState message="Gagal memuat jadwal survey Anda." onRetry={() => void visitsQuery.refetch()} minHeight="8rem" />}
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
                  {vis.notes && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Catatan: "{vis.notes}"</p>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Link to={`/kos/${vis.kos.id}`}>
                  <Button variant="outline" size="sm">Lihat Kos</Button>
                </Link>
                {vis.status === 'SCHEDULED' && (
                  <Button variant="ghost" size="sm" isLoading={cancelVisit.isPending && cancelVisit.variables?.visitId === vis.id} disabled={cancelVisit.isPending} onClick={() => cancelVisit.mutate({ visitId: vis.id })} style={{ color: 'var(--status-overdue-text)' }}>
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
