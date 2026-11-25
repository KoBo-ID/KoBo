import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import type { MyTenancy } from '../../../../backend/src/trpc/router';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { safeCheckoutUrl } from '../../lib/checkout';
import { messageForError } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { supportMailto } from '../../lib/support';
import { useTRPC } from '../../lib/trpc';

type Invoice = MyTenancy['invoices'][number];

const POLL_MS = 3000;
const POLL_WINDOW_MS = 60_000;
const RECONCILE_COOLDOWN_S = 30;

const TERMINAL = new Set(['PAID', 'EXPIRED', 'FAILED', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED']);

/** Why a payment is being refunded (PaymentRefund.reason); an unknown or missing reason falls back to a neutral line. */
const REFUND_REASON: Record<string, string> = {
  HOLD_EXPIRED: 'Pembayaran diterima setelah masa tahan berakhir.',
  INVOICE_ALREADY_PAID: 'Tagihan ini sudah lunas, jadi pembayaran kedua dikembalikan.',
  INVOICE_WAIVED: 'Tagihan ini sudah dihapus oleh pemilik, jadi pembayaran dikembalikan.',
  TENANCY_ENDED: 'Sewa sudah berakhir sebelum pembayaran ini diterima.',
};

/**
 * Payment actions for one invoice (first or any later month). The payment state always comes from the server:
 * the `?result=success` return flag only starts a short wait and is never trusted as proof of payment.
 */
export const InvoicePaymentActions: React.FC<{
  invoice: Invoice;
  returnedPaymentId?: string;
  returnedResult?: 'success' | 'cancel' | null;
  onResolved?: () => void;
}> = ({
  invoice,
  returnedPaymentId,
  returnedResult,
  onResolved,
}) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useSession();
  const isDemo = me?.user.isDemo === true;

  const shouldWaitOnMount = Boolean(returnedPaymentId && returnedResult === 'success');
  const [waitingFor, setWaitingFor] = useState<string | null>(shouldWaitOnMount ? returnedPaymentId! : null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [polling, setPolling] = useState(shouldWaitOnMount);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.booking.mine.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.kos.detail.queryKey() });
  };
  const wait = (paymentId: string) => {
    setWaitingFor(paymentId);
    setStartedAt(Date.now());
    setPolling(true);
  };

  const status = useQuery({
    ...trpc.payment.status.queryOptions({ paymentId: waitingFor ?? '' }),
    enabled: !!waitingFor,
    refetchInterval: (q) => (q.state.status === 'error' || (q.state.data && TERMINAL.has(q.state.data.status)) ? false : polling && Date.now() - startedAt < POLL_WINDOW_MS ? POLL_MS : false),
  });
  const current = status.data;
  const settled = !!current && TERMINAL.has(current.status);

  // Stop polling after the window, so the tenant gets a manual "Periksa Status" instead of an endless spinner.
  useEffect(() => {
    if (!waitingFor || settled) return;
    const left = POLL_WINDOW_MS - (Date.now() - startedAt);
    const t = setTimeout(() => setPolling(false), Math.max(left, 0));
    return () => clearTimeout(t);
  }, [waitingFor, settled, startedAt]);

  useEffect(() => {
    if (!settled) return;
    refresh();
    onResolved?.();
    // Runs once per settle transition; refresh and onResolved are new closures every render and must not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const start = useMutation(
    trpc.payment.start.mutationOptions({
      onSuccess: (res) => {
        if (res.kind === 'REDIRECT') {
          const url = safeCheckoutUrl(res.checkoutUrl);
          if (!url) {
            setError('Tautan pembayaran tidak valid. Coba lagi atau hubungi KoBo.');
            inFlight.current = false;
            return;
          }
          window.location.assign(url); // inFlight stays set: the page is going away
          return;
        }
        inFlight.current = false;
        if (res.kind === 'PROCESSING') wait(res.paymentId);
        else refresh(); // MOCK provider: the completion button appears through activePayment
      },
      onError: (e) => {
        inFlight.current = false;
        setError(messageForError(e));
      },
    }),
  );
  const reconcile = useMutation(
    trpc.payment.reconcile.mutationOptions({
      onSuccess: (res) => {
        qc.setQueryData(trpc.payment.status.queryKey({ paymentId: res.id }), res);
        setCooldown(RECONCILE_COOLDOWN_S);
        // When invoked outside an active ?result=success wait, the status query is disabled so the settle effect will not run.
        if (TERMINAL.has(res.status) && res.id !== waitingFor) {
          refresh();
          onResolved?.();
        }
      },
      onError: (e) => {
        setError(messageForError(e));
        setCooldown(RECONCILE_COOLDOWN_S);
      },
    }),
  );
  const simulate = useMutation(
    trpc.payment.simulate.mutationOptions({
      onSuccess: refresh,
      onError: (e) => setError(messageForError(e)),
    }),
  );

  const begin = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setWaitingFor(null);
    setPolling(false);
    setCooldown(0);
    reconcile.reset();
    start.mutate({ invoiceId: invoice.id });
  };
  const check = (paymentId: string) => {
    setError(null);
    reconcile.mutate({ paymentId });
  };

  const active = invoice.activePayment;
  const latest = invoice.latestPayment;
  const lastAttempt = current ?? latest;
  const refundState = lastAttempt?.status;
  // A paid invoice has nothing to pay, but a second (late) payment on it is being refunded: say so.
  if (invoice.status === 'PAID' && !refundState?.startsWith('REFUND')) return null;
  const awaiting = waitingFor && !settled ? waitingFor : null;
  // The server reads a PENDING attempt past its session expiry as EXPIRED, so this also covers a stale one.
  const lapsed = refundState === 'EXPIRED' || refundState === 'FAILED';
  const why = REFUND_REASON[lastAttempt?.refundReason ?? ''];

  const demoAttempt = isDemo && active?.provider === 'MOCK' && active.status === 'PENDING' ? active : null;
  const resumeUrl = active?.provider === 'XENDIT' && active.status === 'PENDING' ? active.checkoutUrl : null;
  const checkId = awaiting ?? (active?.provider === 'XENDIT' && (active.status === 'PENDING' || active.status === 'CREATING') ? active.id : null);

  // After a Xendit return (or while any wait runs) "Periksa Status" is the main action and resuming is secondary (SIM-016).
  const isSuccessReturn = Boolean(returnedPaymentId && returnedResult === 'success');
  const returnWait = isSuccessReturn || !!awaiting;
  const pollingActive = Boolean(awaiting && polling && Date.now() - startedAt < POLL_WINDOW_MS);

  let message: React.ReactNode = null;
  if (refundState === 'REFUND_PENDING') message = `${why ?? 'Pembayaran Anda sedang dikembalikan.'} Dana sedang dikembalikan.`;
  else if (refundState === 'REFUNDED') message = `${why ?? 'Pembayaran Anda dikembalikan.'} Dana telah dikembalikan.`;
  else if (refundState === 'REFUND_FAILED') {
    message = (
      <>
        {why ?? 'Pembayaran Anda perlu dikembalikan.'} Pengembalian dana gagal diproses.{' '}
        <a href={supportMailto(`Pengembalian dana ${lastAttempt?.id ?? ''}`.trim())} style={{ color: 'var(--primary)', fontWeight: 700 }}>Hubungi KoBo</a>
      </>
    );
  }
  else if (status.isError) message = 'Status pembayaran belum dapat dimuat. Periksa status untuk mencoba lagi.';
  else if (pollingActive) message = isSuccessReturn ? 'Memeriksa status secara otomatis…' : 'Menunggu konfirmasi pembayaran…';
  else if (awaiting) message = 'Pembayaran belum terkonfirmasi. Periksa status untuk memastikan.';
  else if (lapsed && invoice.canPay) message = 'Sesi pembayaran sebelumnya berakhir. Silakan mulai pembayaran baru.';
  else if (lapsed && invoice.status !== 'PAID') message = 'Sesi pembayaran sebelumnya berakhir.';
  else if (reconcile.isSuccess && active?.id === reconcile.data.id && !TERMINAL.has(reconcile.data.status)) {
    message = resumeUrl
      ? 'Pembayaran belum terkonfirmasi. Lanjutkan pembayaran atau coba periksa lagi sebentar lagi.'
      : 'Pembayaran belum terkonfirmasi. Coba periksa lagi sebentar lagi.';
  }

  const showResume = invoice.status !== 'PAID' && !!resumeUrl && (!pollingActive || status.isError);
  const showCheck = Boolean(checkId && (!pollingActive || status.isError));
  const resumeBtn = showResume ? (
    <Button key="resume" variant={returnWait ? 'outline' : 'primary'} size="sm" onClick={() => { const url = safeCheckoutUrl(resumeUrl!); if (url) window.location.assign(url); else setError('Tautan pembayaran tidak valid.'); }}>
      Lanjutkan Pembayaran
    </Button>
  ) : null;
  const checkBtn = showCheck ? (
    <Button key="check" variant={returnWait ? 'primary' : 'outline'} size="sm" isLoading={reconcile.isPending} disabled={reconcile.isPending || cooldown > 0} onClick={() => check(checkId!)}>
      {cooldown > 0 ? `Periksa Status (${cooldown} dtk)` : 'Periksa Status'}
    </Button>
  ) : null;

  return (
    <span className="invoice-pay">
      <span className="invoice-pay__actions">
        {invoice.status !== 'PAID' && invoice.canPay && !awaiting && (
          <Button variant="primary" size="sm" isLoading={start.isPending} disabled={start.isPending} onClick={begin}>
            Bayar Sekarang
          </Button>
        )}
        {returnWait ? (
          <>
            {checkBtn}
            {resumeBtn}
          </>
        ) : (
          <>
            {resumeBtn}
            {checkBtn}
          </>
        )}
        {demoAttempt && (
          <Button variant="accent" size="sm" isLoading={simulate.isPending} onClick={() => simulate.mutate({ paymentId: demoAttempt.id })} icon={<CreditCard size={15} />}>
            Selesaikan Pembayaran
          </Button>
        )}
      </span>
      <span role="status" aria-live="polite" className="invoice-pay__hint">{message}</span>
      {error && <Notice tone="error">{error}</Notice>}
    </span>
  );
};
