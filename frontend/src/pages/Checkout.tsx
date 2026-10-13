import React, { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Footprints, Send, ShieldCheck } from 'lucide-react';
import { addDays, computeCheckoutTotal, MAX_LEASE_MONTHS, todayWIB } from '@kobo/shared/domain';
import { CampusDiscountCard } from '../components/booking/CampusDiscountCard';
import { useAppStore } from '../store/AppContext';
import { useSession } from '../lib/session';
import { useTRPC } from '../lib/trpc';
import { errorCode } from '../lib/queryErrors';
import { messageForError } from '../lib/errors';
import { Button } from '../components/ui/Button';
import { BackButton } from '../components/ui/BackButton';
import { Input } from '../components/ui/Input';
import { Notice } from '../components/ui/Notice';
import { ErrorState, NotFoundState } from '../components/ui/QueryState';
import { SafeImage } from '../components/ui/SafeImage';
import type { KosDetail } from '../../../backend/src/trpc/router';

const formatRupiah = (value: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--border-subtle)',
  padding: '1.5rem',
  boxShadow: 'var(--shadow-sm)',
};

const Row: React.FC<{ label: React.ReactNode; value: React.ReactNode; tone?: 'primary' }> = ({ label, value, tone }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', color: tone ? 'var(--primary)' : 'var(--text-muted)' }}>
    <span>{label}</span>
    <span style={{ fontWeight: 600, color: tone ? 'var(--primary)' : 'var(--text-main)', textAlign: 'right' }}>{value}</span>
  </div>
);

export const Checkout: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const trpc = useTRPC();
  const { data: kos, isPending, error, refetch } = useQuery(trpc.kos.detail.queryOptions({ id }));

  if (isPending) {
    return (
      <div className="app-container" role="status" aria-busy="true" aria-label="Memuat formulir pengajuan" style={{ maxWidth: '960px', paddingTop: '1.5rem', minHeight: '60vh' }}>
        <div style={{ height: '2.4rem', width: 'min(26rem, 80%)', backgroundColor: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }} />
      </div>
    );
  }
  if (error) {
    if (errorCode(error) === 'NOT_FOUND') return <NotFoundState title="Kos tidak ditemukan" text="Kos yang ingin Anda ajukan tidak ada atau sudah tidak tersedia." linkTo="/search" linkLabel="Cari Kos Lain" />;
    return <div className="app-container" style={{ paddingTop: '2rem' }}><ErrorState message="Gagal memuat formulir pengajuan. Periksa koneksi Anda lalu coba lagi." onRetry={() => void refetch()} /></div>;
  }

  const roomId = searchParams.get('room');
  const room = kos.rooms.find((item) => item.id === roomId);
  const duration = Math.min(MAX_LEASE_MONTHS, Math.max(1, Math.trunc(Number(searchParams.get('duration'))) || 1));
  return <ApplicationForm key={`${kos.id}:${room?.id}`} kos={kos} room={room ?? null} initialDuration={duration} />;
};

const ApplicationForm: React.FC<{ kos: KosDetail; room: KosDetail['rooms'][number] | null; initialDuration: number }> = ({ kos, room, initialDuration }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useSession();
  const { openAuthModal } = useAppStore();
  const today = todayWIB(new Date());
  const [startDate, setStartDate] = useState(() => addDays(today, 1));
  const [duration, setDuration] = useState(initialDuration);
  const [occupation, setOccupation] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const create = useMutation(trpc.application.create.mutationOptions({
    onSuccess: () => {
      setSubmitted(true);
      void qc.invalidateQueries({ queryKey: trpc.application.mine.queryKey() });
    },
  }));

  const roomUnavailable = !room || room.status !== 'vacant';
  const breakdown = room
    ? computeCheckoutTotal({ monthlyRent: room.priceMonthly, applicationFee: kos.applicationFee, discountAmount: kos.studentDiscountAmount, campusEmailVerified: !!me?.campusVerified })
    : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!me) return openAuthModal();
    if (!room) return;
    create.mutate({ roomId: room.id, startDate, durationMonths: duration, occupation, note: note.trim() || undefined });
  };

  if (submitted) {
    return (
      <div className="app-container" style={{ maxWidth: '640px', paddingTop: '3rem', paddingBottom: '4rem', textAlign: 'center' }}>
        <div style={{ ...card, padding: '2.5rem 1.5rem' }} role="status">
          <CheckCircle2 size={48} color="var(--status-paid)" style={{ margin: '0 auto 1rem' }} />
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800 }}>Pengajuan Terkirim</h1>
          <p style={{ color: 'var(--text-muted)', margin: '0.5rem auto 0', maxWidth: '430px' }}>Pemilik {kos.name} akan meninjau rencana sewa Anda. Kamar belum ditahan dan Anda belum perlu membayar sebelum pengajuan diterima.</p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.75rem' }}>
            <Link to="/my-kos"><Button variant="primary" size="md">Pantau Pengajuan</Button></Link>
            <Link to={`/kos/${kos.id}`}><Button variant="outline" size="md">Kembali ke Detail Kos</Button></Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container" style={{ maxWidth: '960px', paddingTop: '1.5rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <BackButton style={{ marginBottom: '0.5rem' }} />
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>Pengajuan Sewa</h1>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Kirim rencana sewa untuk ditinjau pemilik. Pembayaran baru tersedia setelah pengajuan diterima.</p>
      </div>

      {roomUnavailable ? (
        <div style={{ ...card, textAlign: 'center', padding: '2.5rem 1.5rem' }} role="alert">
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Kamar ini sudah tidak tersedia</h2>
          <p style={{ color: 'var(--text-muted)', margin: '0.4rem auto 1.25rem', maxWidth: '380px' }}>Pilih kamar lain sebelum mengirim pengajuan.</p>
          <Link to={`/kos/${kos.id}`}><Button variant="primary" size="md">Pilih Kamar Lain</Button></Link>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="checkout-split-layout" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <CampusDiscountCard studentDiscountAmount={kos.studentDiscountAmount} compact />
              <section style={card} aria-labelledby="rental-plan-title">
                <h2 id="rental-plan-title" style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>Rencana Sewa</h2>
                <div className="application-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.9rem' }}>
                  <Input label="Tanggal Mulai Sewa" type="date" value={startDate} min={today} max={addDays(today, 120)} onChange={(event) => setStartDate(event.target.value)} required />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <label htmlFor="application-duration" style={{ fontSize: '0.875rem', fontWeight: 600 }}>Durasi Sewa</label>
                    <select id="application-duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))} style={{ height: 'var(--control-height)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)', padding: '0 0.75rem', backgroundColor: 'var(--bg-surface)', fontSize: '0.95rem' }}>
                      {Array.from({ length: MAX_LEASE_MONTHS }, (_, index) => index + 1).map((months) => <option key={months} value={months}>{months} bulan</option>)}
                    </select>
                  </div>
                  <Input label="Pekerjaan atau kegiatan utama" value={occupation} onChange={(event) => setOccupation(event.target.value)} placeholder="Contoh: Mahasiswa BINUS" maxLength={120} required />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', gridColumn: '1 / -1' }}>
                    <label htmlFor="application-note" style={{ fontSize: '0.875rem', fontWeight: 600 }}>Catatan untuk pemilik <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>(opsional)</span></label>
                    <textarea id="application-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={4} placeholder="Perkenalkan kebutuhan atau rencana tinggal Anda" style={{ resize: 'vertical', minHeight: '96px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)', padding: '0.75rem', backgroundColor: 'var(--bg-surface)', color: 'var(--text-main)', font: 'inherit' }} />
                  </div>
                </div>
                {me && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.85rem' }}>Pengaju: <strong>{me.user.name}</strong> ({me.user.email})</p>}
              </section>
            </div>

            <aside style={{ position: 'sticky', top: 'calc(var(--header-height) + 20px)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-card)', border: '1.5px solid var(--border-strong)', boxShadow: 'var(--shadow-md)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              <div style={{ display: 'flex', gap: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                {kos.images[0] && <SafeImage src={kos.images[0]} alt="" iconSize={20} style={{ width: '72px', height: '72px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />}
                <div>
                  <h2 style={{ fontSize: '1rem', fontWeight: 700, lineHeight: 1.3 }}>{kos.name}</h2>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Kamar {room.roomNumber} ({room.type}) · Lt. {room.floor}</p>
                  {kos.nearestCampus && kos.nearestCampusMeters !== null && <p style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600, marginTop: '0.2rem' }}><Footprints size={12} /> {kos.nearestCampusMeters}m ke {kos.nearestCampus.shortName}</p>}
                </div>
              </div>

              {breakdown && (
                <div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-subtle)', display: 'block', marginBottom: '0.75rem' }}>Perkiraan pembayaran setelah disetujui</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.875rem' }}>
                    <Row label="Sewa bulan pertama" value={formatRupiah(breakdown.rent)} />
                    {breakdown.discount > 0 && <Row tone="primary" label="Diskon mahasiswa" value={`- ${formatRupiah(breakdown.discount)}`} />}
                    <Row label="Biaya aplikasi KoBo" value={formatRupiah(breakdown.applicationFee)} />
                    <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '0.25rem 0' }} />
                    <Row label={<strong>Total perkiraan</strong>} value={formatRupiah(breakdown.total)} tone="primary" />
                  </div>
                </div>
              )}

              {create.isError && <Notice tone="error">{messageForError(create.error)}</Notice>}
              <Button type="submit" variant="primary" size="lg" fullWidth isLoading={create.isPending} icon={<Send size={16} />}>{me ? 'Kirim Pengajuan' : 'Masuk untuk Mengajukan'}</Button>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                <ShieldCheck size={15} color="var(--primary)" style={{ flexShrink: 0 }} />
                <span>Pengajuan tidak menahan kamar dan tidak memindahkan uang.</span>
              </div>
            </aside>
          </div>
        </form>
      )}

      <style>{`
        @media (min-width: 640px) { .application-form-grid { grid-template-columns: 1fr 1fr !important; } }
        @media (min-width: 1024px) { .checkout-split-layout { grid-template-columns: 58fr 42fr !important; } }
      `}</style>
    </div>
  );
};
