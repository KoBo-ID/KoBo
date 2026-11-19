import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import type { MyTenancy } from '../../../../backend/src/trpc/router';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { safeCheckoutUrl } from '../../lib/checkout';
import { messageForError } from '../../lib/errors';
import { useSession } from '../../lib/session';
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
  TENANCY_ENDED: 'Sewa sudah berakhir sebelum pembayaran ini diterima.',
};

/**
 * Payment actions for one invoice (first or any later month). The payment state always comes from the server:
 * the `?result=success` return flag only starts a short wait and is never trusted as proof of payment.
 */
export const InvoicePaymentActions: React.FC<{ invoice: Invoice; returnedPaymentId?: string; onResolved?: () => void }> = ({
  invoice,
  returnedPaymentId,
  onResolved,
}) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useSession();
  const isDemo = me?.user.isDemo === true;

  const [waitingFor, setWaitingFor] = useState<string | null>(returnedPaymentId ?? null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [polling, setPolling] = useState(true);
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

  let message: string | null = null;
  if (refundState === 'REFUND_PENDING') message = `${why ?? 'Pembayaran Anda sedang dikembalikan.'} Dana sedang dikembalikan.`;
  else if (refundState === 'REFUNDED') message = `${why ?? 'Pembayaran Anda dikembalikan.'} Dana telah dikembalikan.`;
  else if (refundState === 'REFUND_FAILED') message = `${why ?? 'Pembayaran Anda perlu dikembalikan.'} Pengembalian dana tertunda. Hubungi KoBo.`;
  else if (status.isError) message = 'Status pembayaran belum dapat dimuat. Periksa status untuk mencoba lagi.';
  else if (awaiting && polling && Date.now() - startedAt < POLL_WINDOW_MS) message = 'Menunggu konfirmasi pembayaran…';
  else if (awaiting) message = 'Pembayaran belum terkonfirmasi. Periksa status untuk memastikan.';
  else if (lapsed && invoice.canPay) message = 'Sesi pembayaran sebelumnya berakhir. Silakan mulai pembayaran baru.';
  else if (lapsed && invoice.status !== 'PAID') message = 'Sesi pembayaran sebelumnya berakhir.';

  const demoAttempt = isDemo && active?.provider === 'MOCK' && active.status === 'PENDING' ? active : null;
  const resumeUrl = active?.provider === 'XENDIT' && active.status === 'PENDING' ? active.checkoutUrl : null;
  const checkId = awaiting ?? (active?.status === 'CREATING' ? active.id : null);

  return (
    <span className="invoice-pay">
      <span className="invoice-pay__actions">
        {invoice.status !== 'PAID' && invoice.canPay && !awaiting && (
          <Button variant="primary" size="sm" isLoading={start.isPending} disabled={start.isPending} onClick={begin}>
            Bayar Sekarang
          </Button>
        )}
        {invoice.status !== 'PAID' && resumeUrl && !awaiting && (
          <Button variant="primary" size="sm" onClick={() => { const url = safeCheckoutUrl(resumeUrl); if (url) window.location.assign(url); else setError('Tautan pembayaran tidak valid.'); }}>
            Lanjutkan Pembayaran
          </Button>
        )}
        {checkId && (!polling || status.isError || Date.now() - startedAt >= POLL_WINDOW_MS || !awaiting) && (
          <Button variant="outline" size="sm" isLoading={reconcile.isPending} disabled={reconcile.isPending || cooldown > 0} onClick={() => check(checkId)}>
            {cooldown > 0 ? `Periksa Status (${cooldown} dtk)` : 'Periksa Status'}
          </Button>
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
