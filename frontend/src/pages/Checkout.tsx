import React, { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, QrCode, ShieldCheck, Lock, Footprints, CheckCircle2, Clock, FlaskConical, FileText } from 'lucide-react';
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
import type { BookingCreated, KosDetail } from '../../../backend/src/trpc/router';

type PayMethod = 'bca_va' | 'mandiri_va' | 'qris';

const formatRupiah = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--border-subtle)',
  padding: '1.5rem',
  boxShadow: 'var(--shadow-sm)',
};

const METHODS: { id: PayMethod; title: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'bca_va', title: 'BCA Virtual Account', hint: 'Verifikasi instan 24 jam · Bebas biaya admin transfer', icon: <CreditCard size={20} color="var(--primary)" /> },
  { id: 'mandiri_va', title: 'Mandiri Virtual Account', hint: "Konfirmasi instan via Livin' by Mandiri", icon: <CreditCard size={20} color="var(--primary)" /> },
  { id: 'qris', title: 'QRIS (Semua E-Wallet & Mobile Banking)', hint: 'GoPay, OVO, Dana, ShopeePay, BCA, Mandiri', icon: <QrCode size={20} color="var(--primary)" /> },
];

const Row: React.FC<{ label: React.ReactNode; value: React.ReactNode; tone?: 'primary' }> = ({ label, value, tone }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', color: tone ? 'var(--primary)' : 'var(--text-muted)' }}>
    <span>{label}</span>
    <span style={{ fontWeight: 600, color: tone ? 'var(--primary)' : 'var(--text-main)' }}>{value}</span>
  </div>
);

export const Checkout: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const trpc = useTRPC();
  const { data: kos, isPending, error, refetch } = useQuery(trpc.kos.detail.queryOptions({ id }));

  if (isPending) {
    return (
      <div className="app-container" role="status" aria-busy="true" aria-label="Memuat halaman pembayaran" style={{ maxWidth: '960px', paddingTop: '1.5rem', minHeight: '60vh' }}>
        <div style={{ height: '2.4rem', width: 'min(26rem, 80%)', backgroundColor: 'var(--bg-muted)', borderRadius: 'var(--radius-md)' }} />
      </div>
    );
  }
  if (error) {
    if (errorCode(error) === 'NOT_FOUND') {
      return <NotFoundState title="Kos tidak ditemukan" text="Kos yang ingin Anda pesan tidak ada atau sudah tidak tersedia." linkTo="/search" linkLabel="Cari Kos Lain" />;
    }
    return (
      <div className="app-container" style={{ paddingTop: '2rem' }}>
        <ErrorState message="Gagal memuat halaman pembayaran. Periksa koneksi Anda lalu coba lagi." onRetry={() => void refetch()} />
      </div>
    );
  }
  const roomId = searchParams.get('room');
  const room = kos.rooms.find((r) => r.id === roomId);
  const duration = Math.min(MAX_LEASE_MONTHS, Math.max(1, Math.trunc(Number(searchParams.get('duration'))) || 1));
  return <CheckoutView key={`${kos.id}:${room?.id}`} kos={kos} room={room ?? null} initialDuration={duration} />;
};

type Kos = KosDetail;

const CheckoutView: React.FC<{ kos: Kos; room: Kos['rooms'][number] | null; initialDuration: number }> = ({ kos, room, initialDuration }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useSession();
  const { openAuthModal } = useAppStore();

  const today = todayWIB(new Date());
  const [startDate, setStartDate] = useState(() => addDays(today, 1));
  const [duration, setDuration] = useState(initialDuration);
  const [method, setMethod] = useState<PayMethod>('bca_va');
  const [booking, setBooking] = useState<BookingCreated | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const create = useMutation(
    trpc.booking.create.mutationOptions({
      onSuccess: (res) => {
        setConflict(null);
        setBooking(res);
        void qc.invalidateQueries({ queryKey: trpc.kos.detail.queryKey({ id: kos.id }) });
        void qc.invalidateQueries({ queryKey: trpc.booking.mine.queryKey() });
      },
      onError: (e) => {
        if (errorCode(e) === 'CONFLICT') {
          // Someone else took the room: refresh availability so the kos page shows it as taken.
          void qc.invalidateQueries({ queryKey: trpc.kos.detail.queryKey({ id: kos.id }) });
        }
      },
    }),
  );
  const simulate = useMutation(trpc.payment.simulate.mutationOptions());
  const paymentId = booking?.payment.id ?? '';
  const status = useQuery({
    ...trpc.payment.status.queryOptions({ paymentId }),
    enabled: !!booking,
    refetchInterval: (q) => (q.state.data?.status === 'PAID' ? false : 2500),
    staleTime: 0,
  });
  const paid = status.data?.status === 'PAID';

  React.useEffect(() => {
    if (paid) {
      void qc.invalidateQueries({ queryKey: trpc.booking.mine.queryKey() });
      void qc.invalidateQueries({ queryKey: trpc.kos.detail.queryKey({ id: kos.id }) });
    }
  }, [paid, qc, trpc, kos.id]);

  const roomTaken = !room || (room.status !== 'vacant' && !booking);
  // Preview with the same shared function the server uses; the server's own breakdown replaces it after booking.
  const preview = room
    ? computeCheckoutTotal({ monthlyRent: room.priceMonthly, applicationFee: kos.applicationFee, discountAmount: kos.studentDiscountAmount, campusEmailVerified: !!me?.campusVerified })
    : null;
  const breakdown = booking?.breakdown ?? preview;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!me) {
      openAuthModal();
      return;
    }
    if (!room) return;
    setConflict(null);
    create.mutate(
      { roomId: room.id, startDate, durationMonths: duration },
      { onError: (err) => setConflict(messageForError(err)) },
    );
  };

  const onSimulate = () => {
    if (!booking) return;
    simulate.mutate({ paymentId: booking.payment.id }, { onSettled: () => void status.refetch() });
  };

  if (paid && status.data) {
    return (
      <div className="app-container" style={{ maxWidth: '640px', paddingTop: '3rem', paddingBottom: '4rem', textAlign: 'center' }}>
        <div style={{ ...card, padding: '2.5rem 1.5rem' }} role="status">
          <CheckCircle2 size={48} color="var(--status-paid)" style={{ margin: '0 auto 1rem' }} />
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800 }}>Pembayaran Berhasil</h1>
          <p style={{ color: 'var(--text-muted)', margin: '0.5rem auto 0', maxWidth: '420px' }}>
            Kamar {room?.roomNumber} di {kos.name} sekarang atas nama Anda. Kuitansi resmi dengan nomor <strong>{status.data.receiptNo}</strong> sudah terbit.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1.75rem' }}>
            {status.data.receiptNumber !== null && (
              <Link to={`/kuitansi/${status.data.receiptNumber}`}>
                <Button variant="outline" size="md" icon={<FileText size={16} />}>Lihat Kuitansi</Button>
              </Link>
            )}
            <Link to="/my-kos">
              <Button variant="primary" size="md">Buka Kos Saya</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const label = METHODS.find((m) => m.id === method)!.title;
  const instruction =
    booking && (method === 'bca_va' ? booking.payment.instructions.bcaVa : method === 'mandiri_va' ? booking.payment.instructions.mandiriVa : booking.payment.instructions.qris);

  return (
    <div className="app-container" style={{ maxWidth: '960px', paddingTop: '1.5rem', paddingBottom: '4rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <BackButton style={{ marginBottom: '0.5rem' }} />
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>Pengajuan Sewa & Pembayaran</h1>
        <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Pilih tanggal masuk dan durasi sewa. Kamar ditahan 24 jam setelah Anda memesan.
        </p>
      </div>

      {roomTaken ? (
        <div style={{ ...card, textAlign: 'center', padding: '2.5rem 1.5rem' }} role="alert">
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Kamar ini sudah tidak tersedia</h2>
          <p style={{ color: 'var(--text-muted)', margin: '0.4rem auto 1.25rem', maxWidth: '380px' }}>{conflict ?? 'Kamar baru saja dibooking orang lain atau tidak ditemukan.'} Pilih kamar lain di kos ini.</p>
          <Link to={`/kos/${kos.id}`}>
            <Button variant="primary" size="md">Pilih Kamar Lain</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem', alignItems: 'start' }} className="checkout-split-layout">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
              <CampusDiscountCard studentDiscountAmount={kos.studentDiscountAmount} compact />

              {!booking ? (
                <div style={card}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>Rencana Sewa</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <Input label="Tanggal Mulai Sewa" type="date" value={startDate} min={today} max={addDays(today, 120)} onChange={(e) => setStartDate(e.target.value)} required />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <label htmlFor="checkout-duration" style={{ fontSize: '0.875rem', fontWeight: 600 }}>Durasi Sewa</label>
                      <select
                        id="checkout-duration"
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                        style={{ height: 'var(--control-height)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)', padding: '0 0.75rem', backgroundColor: 'var(--bg-surface)', fontSize: '0.95rem' }}
                      >
                        {Array.from({ length: MAX_LEASE_MONTHS }, (_, i) => i + 1).map((m) => (
                          <option key={m} value={m}>{m} bulan</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {me && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.85rem' }}>
                      Penyewa: <strong>{me.user.name}</strong> ({me.user.email})
                    </p>
                  )}
                </div>
              ) : null}

              <div style={card}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1rem' }}>{booking ? 'Instruksi Pembayaran' : 'Pilih Metode Pembayaran'}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }} role="radiogroup" aria-label="Metode pembayaran">
                  {METHODS.map((m) => (
                    <label
                      key={m.id}
                      className="interactive-tap"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                        border: `1.5px solid ${method === m.id ? 'var(--primary)' : 'var(--border-subtle)'}`,
                        backgroundColor: method === m.id ? 'var(--primary-light)' : 'var(--bg-surface)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input type="radio" name="payment" checked={method === m.id} onChange={() => setMethod(m.id)} style={{ accentColor: 'var(--primary)' }} />
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '0.95rem', display: 'block' }}>{m.title}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.hint}</span>
                        </div>
                      </div>
                      {m.icon}
                    </label>
                  ))}
                </div>

                {booking && (
                  <div style={{ marginTop: '1.25rem', padding: '1rem', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-page)', border: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>{method === 'qris' ? 'Kode QRIS (contoh)' : `Nomor ${label}`}</span>
                    <span data-testid="payment-instruction" style={{ fontSize: method === 'qris' ? '0.8rem' : '1.4rem', fontWeight: 800, letterSpacing: method === 'qris' ? 0 : '0.05em', wordBreak: 'break-all' }}>{instruction}</span>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.6rem' }}>
                      Transfer tepat <strong>{formatRupiah(booking.payment.amount)}</strong>. Status diperbarui otomatis setelah pembayaran diterima.
                    </p>
                    <p style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--status-due)', marginTop: '0.4rem' }}>
                      <Clock size={14} /> Kamar ditahan sampai {new Date(booking.expiresAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                position: 'sticky', top: 'calc(var(--header-height) + 20px)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)',
                border: '1.5px solid var(--border-strong)', boxShadow: 'var(--shadow-md)', padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', gap: '1rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--border-subtle)' }}>
                {kos.images[0] && <img src={kos.images[0]} alt={kos.name} style={{ width: '75px', height: '75px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }} />}
                <div>
                  <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.3 }}>{kos.name}</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Kamar {room!.roomNumber} ({room!.type}) · Lt. {room!.floor}</p>
                  {kos.nearestCampus && kos.nearestCampusMeters !== null && (
                    <p style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600, marginTop: '0.2rem' }}>
                      <Footprints size={12} /> {kos.nearestCampusMeters}m ke {kos.nearestCampus.shortName}
                    </p>
                  )}
                </div>
              </div>

              {breakdown && (
                <div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '0.75rem' }}>
                    Rincian Tagihan Pertama
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.875rem' }}>
                    <Row label="Sewa Kamar Bulan Pertama" value={formatRupiah(breakdown.rent)} />
                    {breakdown.discount > 0 && <Row tone="primary" label="Diskon Mahasiswa" value={`- ${formatRupiah(breakdown.discount)}`} />}
                    <Row label="Biaya Aplikasi KoBo" value={formatRupiah(breakdown.applicationFee)} />
                    <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '0.35rem 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.25rem', fontWeight: 800 }}>
                      <span>Total Tagihan</span>
                      <span data-testid="checkout-total" style={{ color: 'var(--primary)' }}>{formatRupiah(breakdown.total)}</span>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                      Sewa {duration} bulan: {duration > 1 ? `${duration - 1} tagihan berikutnya ${formatRupiah(breakdown.rent)} per bulan.` : 'tanpa tagihan lanjutan.'}
                    </p>
                  </div>
                </div>
              )}

              {conflict && <Notice tone="error">{conflict}</Notice>}
              {simulate.isError && <Notice tone="error">{messageForError(simulate.error)}</Notice>}

              {!booking ? (
                <Button type="submit" variant="primary" size="lg" fullWidth isLoading={create.isPending} icon={<Lock size={16} />}>
                  {me ? `Pesan & Bayar (${breakdown ? formatRupiah(breakdown.total) : ''})` : 'Masuk untuk Memesan'}
                </Button>
              ) : (
                <Button type="button" variant="accent" size="lg" fullWidth isLoading={simulate.isPending} onClick={onSimulate} icon={<FlaskConical size={16} />}>
                  Simulasikan Pembayaran
                </Button>
              )}
              {booking && <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', textAlign: 'center' }}>Demo: tombol ini meniru notifikasi dari bank. Tidak ada uang sungguhan yang dipindahkan.</p>}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                <ShieldCheck size={14} color="var(--primary)" />
                <span>Harga dihitung server, bukan browser Anda.</span>
              </div>
            </div>
          </div>
        </form>
      )}

      <style>{`
        @media (min-width: 1024px) {
          .checkout-split-layout { grid-template-columns: 58fr 42fr !important; }
        }
      `}</style>
    </div>
  );
};
