import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
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
import { Skeleton } from '../components/ui/Skeleton';
import { useSession } from '../lib/session';
import { useTRPC } from '../lib/trpc';
import { messageForError } from '../lib/errors';
import { formatVisitDate, VISIT_SLOT_LABEL } from '../lib/visits';
import { formatRupiah } from '../lib/format';

type TabId = 'rentals' | 'applications' | 'visits';
const PAGE_TITLE: Record<TabId, string> = { visits: 'Jadwal Survey', applications: 'Pengajuan Sewa', rentals: 'Kamar yang Disewa' };

const ListSkeleton: React.FC<{ label: string; rows?: number }> = ({ label, rows = 2 }) => (
  <div role="status" aria-busy="true" aria-label={label} className="mk-list">
    {Array.from({ length: rows }, (_, i) => (
      <Skeleton key={i} height="6.5rem" borderRadius="var(--radius-card)" />
    ))}
  </div>
);

/** 'YYYY-MM-DD' (a WIB calendar day) as "5 Oktober 2026". */
const formatDate = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

type Tone = 'paid' | 'due' | 'overdue' | 'muted' | 'primary';

const TENANCY_BADGE: Record<string, { label: string; tone: Tone }> = {
  booking: { label: 'Menunggu Pembayaran', tone: 'due' },
  paid: { label: 'Sewa Aktif', tone: 'paid' },
  due: { label: 'Sewa Aktif · Segera Jatuh Tempo', tone: 'due' },
  overdue: { label: 'Menunggak', tone: 'overdue' },
  vacant: { label: 'Selesai', tone: 'muted' },
};

const APPLICATION_BADGE = {
  PENDING: { label: 'Menunggu Pemilik', tone: 'due' },
  APPROVED: { label: 'Diterima', tone: 'paid' },
  REJECTED: { label: 'Tidak Diterima', tone: 'overdue' },
  WITHDRAWN: { label: 'Dibatalkan', tone: 'muted' },
} as const satisfies Record<string, { label: string; tone: Tone }>;

const Badge: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`mk-badge mk-badge--${tone}`}>{children}</span>
);

const Fact: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="mk-fact">
    <span className="mk-fact__label">{label}</span>
    <span className={`mk-fact__value${strong ? ' mk-fact__value--strong' : ''}`}>{value}</span>
  </div>
);

/** The ordered path a student follows. The step that matches the current tab is highlighted. */
const LIFECYCLE = [
  { label: 'Survey gratis', text: 'Lihat kamar langsung sebelum memutuskan.' },
  { label: 'Pengajuan sewa', text: 'Pemilik meninjau dan menerima atau menolak.' },
  { label: 'Sewa aktif', text: 'Bayar tagihan pertama, kuitansi tersimpan di sini.' },
];

const LifecycleStrip: React.FC<{ step: 1 | 2 | 3 }> = ({ step }) => (
  <ol className="mk-steps" aria-label="Jalur sewa">
    {LIFECYCLE.map((s, i) => (
      <li key={s.label} className={`mk-step${step === i + 1 ? ' mk-step--active' : ''}`} aria-current={step === i + 1 ? 'step' : undefined}>
        <span className="mk-step__num" aria-hidden="true">{i + 1}</span>
        <span className="mk-step__label">{s.label}</span>
        <span className="mk-step__text">{s.text}</span>
      </li>
    ))}
  </ol>
);

const MkEmpty: React.FC<{ icon: React.ReactNode; title: string; body: React.ReactNode; action: React.ReactNode; step: 1 | 2 | 3 }> = ({ icon, title, body, action, step }) => (
  <div className="mk-empty">
    <div className="mk-empty__lead">
      <div className="mk-empty__head">
        <span className="mk-empty__icon" aria-hidden="true">{icon}</span>
        <h2 className="mk-empty__title">{title}</h2>
      </div>
      <p className="mk-empty__body">{body}</p>
      <div className="mk-empty__action">{action}</div>
    </div>
    <LifecycleStrip step={step} />
  </div>
);

type TabDef = { id: TabId; icon: React.ReactNode; name: string; count: string };

/** Underline tabs with one sliding indicator and roving focus (arrows, Home, End). */
const MkTabs: React.FC<{ tabs: TabDef[]; active: TabId | null; onSelect: (id: TabId) => void }> = ({ tabs, active, onSelect }) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  const mounted = useRef(false);
  const countKey = tabs.map((t) => t.count).join('|');

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const el = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (el) setBar((b) => (b && b.x === el.offsetLeft && b.w === el.offsetWidth ? b : { x: el.offsetLeft, w: el.offsetWidth }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    list.querySelectorAll('[role="tab"]').forEach((t) => ro.observe(t));
    return () => ro.disconnect();
  }, [active, countKey]);

  // Enable the slide only after the first paint, so the indicator does not fly in from the left.
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Keep the selected tab in view when the list scrolls sideways on a narrow screen.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = active ? tabs.findIndex((t) => t.id === active) : 0;
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(tabs[next].id);
    document.getElementById(`mk-tab-${tabs[next].id}`)?.focus();
  };

  return (
    <div ref={listRef} role="tablist" aria-label="Kos Saya" className="mk-tabs" onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            id={`mk-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls="mk-panel"
            aria-label={`${tab.name} (${tab.count})`}
            tabIndex={selected || (!active && tab.id === tabs[0].id) ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className="mk-tab interactive-tap"
          >
            {tab.icon}
            <span>{tab.name}</span>
            <span className="mk-count" aria-hidden="true">{tab.count}</span>
          </button>
        );
      })}
      {bar && (
        <span
          aria-hidden="true"
          className={`mk-tabs__indicator${ready ? ' mk-tabs__indicator--ready' : ''}`}
          style={{ width: bar.w, transform: `translateX(${bar.x}px)` }}
        />
      )}
    </div>
  );
};

/** One 6px bar per invoice. Visual only: the invoice table below is the accessible source of truth. */
const MonthTimeline: React.FC<{ t: MyTenancy; nextId?: string }> = ({ t, nextId }) => (
  <div className="mk-timeline" aria-hidden="true">
    <div className="mk-timeline__bars">
      {t.invoices.map((inv) => {
        const state = inv.status === 'PAID' ? 'paid' : t.status === 'ENDED' ? 'ended' : inv.id === nextId ? 'due' : 'later';
        return <span key={inv.id} className={`mk-timeline__bar${state === 'later' ? '' : ` mk-timeline__bar--${state}`}`} />;
      })}
    </div>
    <div className="mk-timeline__labels">
      <span>Bulan 1</span>
      {t.invoices.length > 1 && <span>Bulan {t.invoices.length}</span>}
    </div>
  </div>
);

export const MyKos: React.FC = () => {
  useDocumentTitle('Kos Saya');
  const { addToast, openAuthModal } = useAppStore();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me, isLoading: sessionLoading } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  // From the gateway return URL. Only used to start a short wait; the server decides what actually happened.
  const returnedPayment = searchParams.get('payment');
  const [chosenTab, setActiveTab] = useState<TabId | null>(null);
  const [reviewing, setReviewing] = useState<{ tenancyId: string; kosName: string; existing: MyReview | null } | null>(null);

  const mine = useQuery({ ...trpc.booking.mine.queryOptions(), enabled: !!me });
  const applicationQuery = useQuery({ ...trpc.application.mine.queryOptions(), enabled: !!me });
  const visitsQuery = useQuery({ ...trpc.visit.mine.queryOptions(), enabled: !!me });
  const visits = me ? (visitsQuery.data ?? []) : [];
  const scheduledCount = visits.filter((v) => v.status === 'SCHEDULED').length;
  // A count is shown only once its query has answered; while the session or the query is loading, or after a failure, it reads "–", never "(0)".
  const countLabel = (q: { isSuccess: boolean }, n: number) => ((!me && !sessionLoading) || q.isSuccess ? String(n) : '–');
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
  // Until the user picks a tab, land on the furthest stage that has content (the tabs follow the rental path).
  const defaultTab: TabId = rentals.length > 0 ? 'rentals' : applications.length > 0 ? 'applications' : 'visits';
  // While any query is still answering, no tab is chosen yet, so the page does not flip from one tab to another.
  const settling = !chosenTab && !!me && (mine.isPending || applicationQuery.isPending || visitsQuery.isPending);
  const activeTab: TabId | null = chosenTab ?? (settling ? null : defaultTab);

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

  const tabs: TabDef[] = [
    { id: 'visits', icon: <Calendar size={18} />, name: 'Jadwal Survey Gratis', count: countLabel(visitsQuery, scheduledCount) },
    { id: 'applications', icon: <ClipboardList size={18} />, name: 'Pengajuan Sewa', count: countLabel(applicationQuery, applications.length) },
    { id: 'rentals', icon: <Home size={18} />, name: 'Kamar yang Disewa', count: countLabel(mine, rentals.length) },
  ];
  const signInAction = <Button variant="primary" size="md" onClick={openAuthModal}>Masuk</Button>;
  const searchAction = (label: string) => (
    <Link to="/search">
      <Button variant="primary" size="md">{label}</Button>
    </Link>
  );

  return (
    <div className="app-container my-kos">
      <div className="mk-head">
        <h1 className="page-title">{activeTab ? PAGE_TITLE[activeTab] : 'Kos Saya'}</h1>
      </div>

      <MkTabs tabs={tabs} active={activeTab} onSelect={setActiveTab} />

      <section id="mk-panel" role="tabpanel" aria-labelledby={activeTab ? `mk-tab-${activeTab}` : undefined} className="mk-panel">
        <div key={activeTab ?? 'settling'} className="mk-panel__body mk-panel-enter">
          {settling && <ListSkeleton label="Memuat Kos Saya" />}
          {/* Tab 1: tenancies from the server (booking.mine) */}
          {activeTab === 'rentals' && (
            <>
              {!me && !sessionLoading && (
                <MkEmpty
                  step={3}
                  icon={<Home size={24} />}
                  title="Masuk untuk Melihat Kos Anda"
                  body="Kamar yang Anda sewa, tagihan bulanan, dan kuitansi tersimpan di akun Anda."
                  action={signInAction}
                />
              )}
              {me && mine.isPending && <ListSkeleton label="Memuat kamar Anda" />}
              {me && mine.isError && <ErrorState message="Gagal memuat daftar sewa Anda." onRetry={() => void mine.refetch()} minHeight="10rem" />}
              {me && <WaitlistSection />}

              {rentals.map((t) => {
                const badge = TENANCY_BADGE[t.derivedStatus] ?? TENANCY_BADGE.paid;
                const nextInvoice = t.invoices.find((i) => i.status === 'UNPAID');
                const firstReceipt = t.invoices.find((i) => i.receiptNumber !== null);
                return (
                  <div key={t.id} data-testid="tenancy-card" data-status={t.status} className="mk-pass">
                    <div className="mk-pass__head">
                      <div className="mk-pass__id">
                        {t.kos.image && <SafeImage src={t.kos.image} alt={t.kos.name} className="mk-pass__img" />}
                        <div style={{ minWidth: 0 }}>
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                          <h3 className="mk-pass__name">{t.kos.name}</h3>
                          <p className="mk-pass__meta">
                            Kamar <strong>{t.room.roomNumber}</strong> (Lt. {t.room.floor}) · {t.kos.address}
                          </p>
                        </div>
                      </div>
                      <div className="mk-pass__price">
                        <span className="mk-pass__price-label">Sewa Bulanan</span>
                        <span className="mk-pass__price-value">{formatRupiah(t.room.priceMonthly)}</span>
                        <span className="mk-pass__price-label">/ bulan</span>
                      </div>
                    </div>

                    <div className="mk-facts">
                      <Fact label="Mulai Sewa" value={formatDate(t.startDate)} />
                      <Fact label="Durasi Sewa" value={`${t.durationMonths} Bulan`} />
                      <Fact label={t.status === 'PENDING' ? 'Tagihan Pertama' : 'Jatuh Tempo Berikutnya'} value={nextInvoice ? formatDate(nextInvoice.dueDate) : 'Lunas'} strong />
                      <Fact label="Pemilik Kos" value={t.kos.ownerName} />
                    </div>

                    <MonthTimeline t={t} nextId={nextInvoice?.id} />

                    <div role="table" aria-label="Tagihan" className="mk-invoices">
                      {t.invoices.map((inv, i) => (
                        <div key={inv.id} role="row" className="invoice-row" style={{ borderTop: i ? '1px solid var(--border-subtle)' : undefined }}>
                          <span role="cell">Bulan {i + 1} · jatuh tempo {formatDate(inv.dueDate)}</span>
                          <span role="cell" className="invoice-row__meta">
                            <strong>{formatRupiah(inv.amount)}</strong>
                            <span className={`mk-invoice-status${inv.status === 'PAID' ? ' mk-invoice-status--paid' : ''}`}>{inv.status === 'PAID' ? 'Lunas' : t.status === 'ENDED' ? 'Tidak ditagih, sewa berakhir' : 'Belum dibayar'}</span>
                            <InvoicePaymentActions
                              invoice={inv}
                              returnedPaymentId={returnedPayment && (inv.activePayment?.id === returnedPayment || inv.latestPayment?.id === returnedPayment) ? returnedPayment : undefined}
                              onResolved={() => setSearchParams({}, { replace: true })}
                            />
                            {inv.receiptNumber !== null && (
                              <Link to={`/kuitansi/${inv.receiptNumber}`} className="mk-link">{inv.receiptNo}</Link>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="mk-pass__foot">
                      <div className="mk-pass__note">
                        <ShieldCheck size={16} />
                        <span>
                          {t.status === 'ENDED'
                            ? `Sewa berakhir${t.endedAt ? ` pada ${new Date(t.endedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}`
                            : t.status === 'PENDING' && t.expiresAt
                              ? `Kamar ditahan sampai ${new Date(t.expiresAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`
                              : 'Pembayaran tercatat di KoBo'}
                        </span>
                      </div>
                      <div className="mk-pass__actions">
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
                            className="mk-wa"
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
                <MkEmpty
                  step={3}
                  icon={<Home size={24} />}
                  title="Belum Ada Kamar Kos yang Disewa"
                  body="Cari kos, jadwalkan survey, lalu ajukan sewa. Kamar yang Anda sewa muncul di sini."
                  action={searchAction('Cari Kos Sekarang')}
                />
              )}
            </>
          )}

          {/* Tab 2: rental applications (application.mine) */}
          {activeTab === 'applications' && (
            <>
              {!me && !sessionLoading && (
                <MkEmpty
                  step={2}
                  icon={<ClipboardList size={24} />}
                  title="Masuk untuk melihat pengajuan Anda"
                  body="Pengajuan sewa yang Anda kirim, beserta keputusan pemilik, tersimpan di akun Anda."
                  action={signInAction}
                />
              )}
              {me && applicationQuery.isPending && <ListSkeleton label="Memuat pengajuan Anda" rows={1} />}
              {me && applicationQuery.isError && <ErrorState message="Gagal memuat pengajuan sewa Anda." onRetry={() => void applicationQuery.refetch()} minHeight="8rem" />}
              {applications.length > 0 && (
                <div className="mk-list">
                  {applications.map((application) => {
                    const badge = APPLICATION_BADGE[application.status];
                    return (
                      <div key={application.id} data-testid="application-card" className="application-card mk-row">
                        <div className="application-card__main">
                          {application.kos.image ? <SafeImage src={application.kos.image} alt="" iconSize={20} className="mk-row__thumb" /> : <span className="mk-row__icon"><ClipboardList size={22} /></span>}
                          <div style={{ minWidth: 0 }}>
                            <div className="mk-row__title">
                              <strong>{application.kos.name}</strong>
                              <Badge tone={badge.tone}>{badge.label}</Badge>
                            </div>
                            <p className="mk-row__meta">Kamar {application.room.roomNumber} · mulai {formatDate(application.startDate)} · {application.durationMonths} bulan</p>
                            {application.status === 'PENDING' && <p className="mk-row__note">Kamar belum ditahan. Pemilik sedang meninjau pengajuan.</p>}
                            {application.status === 'APPROVED' && <p className={`mk-row__note${liveCardFor(application) ? ' mk-row__note--good' : ''}`}>{approvedNote(application)}</p>}
                          </div>
                        </div>
                        <Link to={`/kos/${application.kos.id}`} className="application-card__action"><Button variant="outline" size="sm">Lihat Kos</Button></Link>
                      </div>
                    );
                  })}
                </div>
              )}
              {me && applicationQuery.isSuccess && applications.length === 0 && (
                <MkEmpty
                  step={2}
                  icon={<ClipboardList size={24} />}
                  title="Belum ada pengajuan sewa"
                  body="Pilih kamar di halaman kos, lalu kirim pengajuan. Statusnya muncul di sini sampai pemilik memutuskan."
                  action={searchAction('Cari kos')}
                />
              )}
            </>
          )}

          {/* Tab 3: free visits from the server (visit.mine) */}
          {activeTab === 'visits' && (
            <>
              {cancelVisit.isError && <Notice tone="error">{messageForError(cancelVisit.error)}</Notice>}
              {!me && !sessionLoading && (
                <MkEmpty
                  step={1}
                  icon={<Calendar size={24} />}
                  title="Masuk untuk melihat jadwal survey Anda"
                  body="Janji lihat kamar yang Anda buat tersimpan di akun Anda."
                  action={signInAction}
                />
              )}
              {me && visitsQuery.isPending && <ListSkeleton label="Memuat jadwal survey" rows={1} />}
              {me && visitsQuery.isError && <ErrorState message="Gagal memuat jadwal survey Anda." onRetry={() => void visitsQuery.refetch()} minHeight="8rem" />}
              {visits.length > 0 && (
                <div className="mk-list">
                  {visits.map((vis) => (
                    <div key={vis.id} className="application-card mk-row">
                      <div className="application-card__main">
                        <span className="mk-row__icon"><Calendar size={22} /></span>
                        <div style={{ minWidth: 0 }}>
                          <div className="mk-row__title">
                            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{vis.kos.name}</h3>
                            <Badge tone={vis.status === 'SCHEDULED' ? 'primary' : 'muted'}>
                              {vis.status === 'SCHEDULED' ? 'Terjadwal' : vis.status === 'COMPLETED' ? 'Selesai' : 'Dibatalkan'}
                            </Badge>
                          </div>
                          <p className="mk-row__meta">
                            Tanggal: <strong>{formatVisitDate(vis.date)}</strong> · Sesi{' '}
                            <strong>{VISIT_SLOT_LABEL[vis.timeSlot]}</strong>
                          </p>
                          {vis.notes && <p className="mk-row__note">Catatan: "{vis.notes}"</p>}
                        </div>
                      </div>
                      <div className="mk-row__actions">
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
                </div>
              )}
              {me && visitsQuery.isSuccess && visits.length === 0 && (
                <MkEmpty
                  step={1}
                  icon={<Calendar size={24} />}
                  title="Belum Ada Jadwal Survey"
                  body={<>Gunakan fitur <strong>Survey Dulu Gratis</strong> di halaman detail kos untuk membuat janji lihat kamar.</>}
                  action={searchAction('Jelajahi Kos Dekat Kampus')}
                />
              )}
            </>
          )}
        </div>
      </section>

      {reviewing && <ReviewFormModal onClose={() => setReviewing(null)} {...reviewing} />}
    </div>
  );
};
